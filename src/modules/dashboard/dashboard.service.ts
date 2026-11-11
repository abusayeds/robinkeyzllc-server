import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DraftKind,
  DraftStatus,
  FreeAgencyOfferStatus,
  LeaguePlayerStatus,
  RosterSlotType,
  TradeResponse,
  TradeStatus,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import { CapService } from '../cap/cap.service';
import { HardCapService } from '../cap/hard-cap.service';
import { TIER_LABEL, tierFor } from '../cap/cap.tiers';
import { TransactionsService } from '../transactions/transactions.service';

/** How many dates ahead the owner's front page shows. */
const UPCOMING_LIMIT = 4;

/** How many past moves the activity list carries. */
const ACTIVITY_LIMIT = 8;

/** A trade exception inside this many days is worth saying out loud. */
const EXPIRING_SOON_DAYS = 30;

/** Trades that are still waiting on somebody. */
const LIVE_TRADE_STATUSES = [
  TradeStatus.proposed,
  TradeStatus.accepted,
  TradeStatus.awaitingApproval,
] as const;

type Severity = 'action' | 'warning' | 'info';

type AttentionItem = {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  href: string;
  count: number;
};

const money = (value: number) =>
  `$${Math.round(value).toLocaleString('en-US')}`;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capService: CapService,
    private readonly hardCapService: HardCapService,
    private readonly transactionsService: TransactionsService,
  ) {}

  /**
   * One team's front office, in one request.
   *
   * Assembled on the server for the same reason the league office page is: the
   * cap figures, the tier, the hard cap and the roster counts all have to agree
   * with one another, and a page that reads contracts at one moment and the
   * roster at another can show a team salary that never existed.
   *
   * Deliberately **not** here: record, matchups and category standings. Those
   * come from the scoring engine and are league-wide rather than team-shaped,
   * so the page reads them from the standings endpoints instead — one source
   * per kind of number.
   */
  async team(leagueId: number, teamId: number, userId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: {
        id: true,
        name: true,
        logo: true,
        season: true,
        settings: {
          select: {
            minRosterSize: true,
            maxRosterSize: true,
            maxTwoWay: true,
          },
        },
      },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: {
        id: true,
        name: true,
        abbr: true,
        color: true,
        logo: true,
        members: {
          select: {
            role: true,
            userId: true,
            user: { select: { id: true, name: true, image: true } },
          },
        },
      },
    });
    if (!team) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Team not found');
    }

    const seasonStartYear =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();
    const cap = await this.capService.forLeague(leagueId, seasonStartYear);

    const [
      roster,
      contractYears,
      deadMoney,
      capHolds,
      liveTrades,
      ownOffers,
      upcoming,
      exceptions,
      picks,
      liveDraft,
    ] = await Promise.all([
      this.prisma.leaguePlayer.findMany({
        where: { leagueId, teamId },
        select: { status: true, slotType: true },
      }),
      this.prisma.contractYear.aggregate({
        where: {
          seasonStartYear,
          contract: { leagueId, teamId, isActive: true },
        },
        _sum: { capHit: true },
      }),
      this.prisma.deadMoney.aggregate({
        where: { leagueId, teamId, seasonStartYear },
        _sum: { amount: true },
      }),
      this.prisma.capHold.aggregate({
        where: { leagueId, teamId, seasonStartYear },
        _sum: { amount: true },
      }),
      this.prisma.trade.findMany({
        where: {
          leagueId,
          status: { in: [...LIVE_TRADE_STATUSES] },
          teams: { some: { teamId } },
        },
        select: {
          id: true,
          status: true,
          requiresApproval: true,
          teams: { select: { teamId: true, response: true } },
        },
      }),
      this.prisma.freeAgencyOffer.count({
        where: { leagueId, teamId, status: FreeAgencyOfferStatus.pending },
      }),
      this.prisma.leagueCalendarEvent.findMany({
        where: { leagueId, season: league.season },
        orderBy: { startDate: 'asc' },
        select: {
          id: true,
          title: true,
          phase: true,
          startDate: true,
          endDate: true,
          isApproximate: true,
          displayLabel: true,
          time: true,
        },
      }),
      this.prisma.tradeException.findMany({
        where: { leagueId, teamId, isActive: true, remaining: { gt: 0 } },
        orderBy: { expiresAt: 'asc' },
        select: {
          id: true,
          label: true,
          amount: true,
          remaining: true,
          expiresAt: true,
        },
      }),
      this.prisma.draftPick.findMany({
        where: {
          leagueId,
          currentTeamId: teamId,
          usedAt: null,
          seasonStartYear: { gte: seasonStartYear },
        },
        select: { seasonStartYear: true, round: true, originalTeamId: true },
        orderBy: [{ seasonStartYear: 'asc' }, { round: 'asc' }],
      }),
      // A running draft, and the slot it is waiting on. The first unpicked
      // slot is the pick on the clock — the same rule the draft room's board
      // settles against, read here rather than recomputed.
      this.prisma.leagueDraft.findFirst({
        where: { leagueId, status: DraftStatus.inProgress },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          kind: true,
          seasonStartYear: true,
          slots: {
            where: { pickedAt: null },
            orderBy: { overall: 'asc' },
            take: 1,
            select: { overall: true, round: true, teamId: true },
          },
          _count: { select: { slots: true } },
        },
      }),
    ]);

    const payroll = contractYears._sum.capHit ?? 0;
    const dead = deadMoney._sum.amount ?? 0;
    const holds = capHolds._sum.amount ?? 0;
    const teamSalary = payroll + dead + holds;

    const tier = tierFor(teamSalary, cap);
    const hardCap = await this.hardCapService.statusFor(
      leagueId,
      teamId,
      seasonStartYear,
      teamSalary,
    );

    const rostered = roster.filter(
      (row) => row.status === LeaguePlayerStatus.rostered,
    );
    const counts = {
      standard: rostered.filter(
        (row) => row.slotType === RosterSlotType.standard,
      ).length,
      twoWay: rostered.filter((row) => row.slotType === RosterSlotType.twoWay)
        .length,
      injuredReserve: rostered.filter(
        (row) => row.slotType === RosterSlotType.injuredReserve,
      ).length,
      rightsHeld: roster.filter(
        (row) => row.status === LeaguePlayerStatus.rightsHeld,
      ).length,
    };

    // Two-way players do not count toward the roster minimum (Rule 4.8), and
    // the same rule is what the hard cap reserve is measured against, so the
    // two screens agree by using one definition.
    const rosterForMinimum = counts.standard + counts.injuredReserve;
    const minRosterSize = league.settings?.minRosterSize ?? 0;
    const maxRosterSize = league.settings?.maxRosterSize ?? 0;
    const maxTwoWay = league.settings?.maxTwoWay ?? 0;

    const memberRole = team.members.find(
      (member) => member.userId === userId,
    )?.role;

    return {
      seasonStartYear,
      season: league.season,
      league: { id: league.id, name: league.name, logo: league.logo },
      team: {
        id: team.id,
        name: team.name,
        abbr: team.abbr,
        color: team.color,
        logo: team.logo,
        owner: team.members.find((m) => m.role === 'owner')?.user ?? null,
        coOwner: team.members.find((m) => m.role === 'coOwner')?.user ?? null,
        /** Whether the caller holds this team, which decides what is clickable. */
        isMine: memberRole !== undefined,
        myRole: memberRole ?? null,
      },
      cap: {
        isSet: cap.isSet,
        source: cap.source,
        salaryCap: cap.salaryCap,
        salaryFloor: cap.salaryFloor,
        luxuryTax: cap.luxuryTax,
        firstApron: cap.firstApron,
        secondApron: cap.secondApron,
        payroll,
        deadMoney: dead,
        capHolds: holds,
        teamSalary,
        capSpace: cap.isSet ? cap.salaryCap - teamSalary : null,
        tier,
        tierLabel: TIER_LABEL[tier],
        /** Rule 3.5 — tracked and shown, with no penalty in Version 1. */
        belowFloor: cap.isSet && teamSalary < cap.salaryFloor,
        floorShortfall:
          cap.isSet && teamSalary < cap.salaryFloor
            ? cap.salaryFloor - teamSalary
            : 0,
      },
      /** Rule 4.7 — null `apron` means no ceiling applies, which is most teams. */
      hardCap,
      roster: {
        ...counts,
        minRosterSize,
        maxRosterSize,
        maxTwoWay,
        rosterForMinimum,
        openSpots: Math.max(0, minRosterSize - rosterForMinimum),
        belowMinimum: minRosterSize > 0 && rosterForMinimum < minRosterSize,
        overMaximum: maxRosterSize > 0 && rosterForMinimum > maxRosterSize,
        overTwoWay: counts.twoWay > maxTwoWay,
      },
      attention: this.attention({
        teamId,
        liveDraft,
        liveTrades,
        ownOffers,
        exceptions,
        hardCap,
        belowFloor: cap.isSet && teamSalary < cap.salaryFloor,
        floorShortfall:
          cap.isSet && teamSalary < cap.salaryFloor
            ? cap.salaryFloor - teamSalary
            : 0,
        belowMinimum: minRosterSize > 0 && rosterForMinimum < minRosterSize,
        openSpots: Math.max(0, minRosterSize - rosterForMinimum),
        overMaximum: maxRosterSize > 0 && rosterForMinimum > maxRosterSize,
      }),
      upcoming: this.upcomingFrom(upcoming),
      // The same feed the Transactions page reads, narrowed to this team,
      // so one trade cannot be described two different ways.
      activity: await this.transactionsService.forTeam(
        leagueId,
        teamId,
        ACTIVITY_LIMIT,
      ),
      draftAssets: {
        total: picks.length,
        byYear: this.picksByYear(picks, teamId),
      },
      exceptions: exceptions.map((row) => ({
        ...row,
        expiresAt: row.expiresAt.toISOString(),
      })),
    };
  }

  /**
   * What only this team can clear, worst first.
   *
   * A list rather than a set of flags: the page shows the ones that exist and
   * nothing when the team is in order, so a tidy front office is quiet.
   */
  private attention(input: {
    teamId: number;
    liveDraft: {
      kind: DraftKind;
      seasonStartYear: number;
      slots: { overall: number; round: number; teamId: number }[];
      _count: { slots: number };
    } | null;
    liveTrades: {
      id: number;
      status: TradeStatus;
      requiresApproval: boolean;
      teams: { teamId: number; response: TradeResponse }[];
    }[];
    ownOffers: number;
    exceptions: { remaining: number; expiresAt: Date }[];
    hardCap: { apron: string | null; pass: boolean; shortfall: number };
    belowFloor: boolean;
    floorShortfall: number;
    belowMinimum: boolean;
    openSpots: number;
    overMaximum: boolean;
  }): AttentionItem[] {
    const items: AttentionItem[] = [];

    // First, because it is the only item with a deadline measured in minutes.
    // No slot left means every pick is in and the room is waiting to close,
    // which is not something to chase anybody about.
    const onClock = input.liveDraft?.slots[0] ?? null;
    if (input.liveDraft && onClock) {
      const href =
        input.liveDraft.kind === DraftKind.startup
          ? '/league/draft/startup'
          : '/league/draft/rookie';
      const where = `Pick ${onClock.overall} of ${input.liveDraft._count.slots}, round ${onClock.round}`;

      items.push(
        onClock.teamId === input.teamId
          ? {
              kind: 'draftOnTheClock',
              severity: 'action',
              title: 'You are on the clock',
              detail: `${where}. The pick is made for you if the clock runs out.`,
              href,
              count: 1,
            }
          : {
              kind: 'draftLive',
              severity: 'info',
              title: 'The draft is live',
              detail: `${where}. Another team is picking.`,
              href,
              count: 1,
            },
      );
    }

    const awaitingThisTeam = input.liveTrades.filter((trade) =>
      trade.teams.some(
        (side) =>
          side.teamId === input.teamId &&
          side.response === TradeResponse.pending,
      ),
    ).length;

    // Said yes and still waiting: either on another team or on the
    // commissioner. Worth showing, but it is not this owner's move.
    const waitingOnOthers = input.liveTrades.length - awaitingThisTeam;

    if (awaitingThisTeam > 0) {
      items.push({
        kind: 'tradeAwaitingYou',
        severity: 'action',
        title: `${awaitingThisTeam} trade offer${awaitingThisTeam === 1 ? '' : 's'} waiting on you`,
        detail: 'Accept or decline in the Trade Center.',
        href: '/my-team/trade-center',
        count: awaitingThisTeam,
      });
    }

    if (!input.hardCap.pass && input.hardCap.apron) {
      items.push({
        kind: 'overHardCap',
        severity: 'action',
        title: `Over your hard cap by ${money(input.hardCap.shortfall)}`,
        detail: 'Rule 4.3 blocks every move until that much salary is cleared.',
        href: '/my-team/contracts',
        count: 1,
      });
    }

    if (input.overMaximum) {
      items.push({
        kind: 'overRosterMaximum',
        severity: 'action',
        title: 'Roster is over the league maximum',
        detail: 'Release or trade a player to get back within the limit.',
        href: '/my-team',
        count: 1,
      });
    }

    if (input.belowMinimum) {
      items.push({
        kind: 'belowRosterMinimum',
        severity: 'warning',
        title: `${input.openSpots} roster spot${input.openSpots === 1 ? '' : 's'} to fill`,
        detail: 'Sign free agents to reach the league minimum.',
        href: '/league/free-agency',
        count: input.openSpots,
      });
    }

    const expiringSoon = input.exceptions.filter(
      (row) =>
        row.expiresAt.getTime() - Date.now() <
        EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000,
    );
    if (expiringSoon.length > 0) {
      const total = expiringSoon.reduce((sum, row) => sum + row.remaining, 0);
      items.push({
        kind: 'expiringException',
        severity: 'warning',
        title: `${money(total)} in trade exceptions expiring`,
        detail: `Within ${EXPIRING_SOON_DAYS} days. Unused room is lost (Rule 7.6).`,
        href: '/my-team/trade-center',
        count: expiringSoon.length,
      });
    }

    if (input.belowFloor) {
      items.push({
        kind: 'belowFloor',
        severity: 'info',
        title: `${money(input.floorShortfall)} below the salary floor`,
        detail: 'Tracked only — Version 1 carries no penalty (Rule 3.5).',
        href: '/my-team/contracts',
        count: 1,
      });
    }

    if (input.ownOffers > 0) {
      items.push({
        kind: 'offersOut',
        severity: 'info',
        title: `${input.ownOffers} free agency offer${input.ownOffers === 1 ? '' : 's'} out`,
        detail: 'Waiting on the player or the commissioner.',
        href: '/league/free-agency',
        count: input.ownOffers,
      });
    }

    if (waitingOnOthers > 0) {
      items.push({
        kind: 'tradeWaitingOnOthers',
        severity: 'info',
        title: `${waitingOnOthers} trade${waitingOnOthers === 1 ? '' : 's'} waiting on someone else`,
        detail: 'You have answered; the deal is not yours to move.',
        href: '/my-team/trade-center',
        count: waitingOnOthers,
      });
    }

    return items;
  }

  /**
   * The next few dates, and today's span if one is running.
   *
   * An event with an `endDate` stays up while it is open — free agency is not
   * past news on its second day.
   */
  private upcomingFrom(
    events: {
      id: number;
      title: string;
      phase: string;
      startDate: Date;
      endDate: Date | null;
      isApproximate: boolean;
      displayLabel: string | null;
      time: string | null;
    }[],
  ) {
    const now = Date.now();

    return events
      .filter((event) => {
        const end = event.endDate ?? event.startDate;
        return end.getTime() >= now;
      })
      .slice(0, UPCOMING_LIMIT)
      .map((event) => ({
        id: event.id,
        title: event.title,
        phase: event.phase,
        startDate: event.startDate.toISOString(),
        endDate: event.endDate?.toISOString() ?? null,
        isApproximate: event.isApproximate,
        displayLabel: event.displayLabel,
        time: event.time,
        /** Already running, which reads differently from "coming up". */
        isLive:
          event.startDate.getTime() <= now &&
          (event.endDate?.getTime() ?? event.startDate.getTime()) >= now,
      }));
  }

  /**
   * Picks this team holds, by draft year.
   *
   * `viaTrade` counts the ones whose seat belongs to another team, because
   * "four picks in 2029" and "four picks, two of them someone else's" are
   * different positions to be in.
   */
  private picksByYear(
    picks: { seasonStartYear: number; round: number; originalTeamId: number }[],
    teamId: number,
  ) {
    const byYear = new Map<
      number,
      {
        seasonStartYear: number;
        firstRound: number;
        secondRound: number;
        viaTrade: number;
      }
    >();

    for (const pick of picks) {
      const row = byYear.get(pick.seasonStartYear) ?? {
        seasonStartYear: pick.seasonStartYear,
        firstRound: 0,
        secondRound: 0,
        viaTrade: 0,
      };
      if (pick.round === 1) row.firstRound += 1;
      else row.secondRound += 1;
      if (pick.originalTeamId !== teamId) row.viaTrade += 1;
      byYear.set(pick.seasonStartYear, row);
    }

    return [...byYear.values()].sort(
      (a, b) => a.seasonStartYear - b.seasonStartYear,
    );
  }
}
