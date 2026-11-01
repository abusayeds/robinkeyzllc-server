import { HttpStatus, Injectable } from '@nestjs/common';
import {
  FreeAgencyOfferStatus,
  LeagueInviteStatus,
  LeaguePlayerStatus,
  RosterSlotType,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import { CapService } from '../cap/cap.service';

/** How many dates ahead the league office shows. */
const UPCOMING_LIMIT = 5;

type TeamTotals = {
  id: number;
  name: string;
  abbr: string;
  color: string;
  logo: string | null;
  hasOwner: boolean;
  rosterCount: number;
  twoWayCount: number;
  payroll: number;
};

@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capService: CapService,
  ) {}

  /**
   * Everything the league office landing page shows, in one request.
   *
   * Assembled here rather than left to the page to fetch six endpoints and add
   * them up. The totals have to agree with one another, and a page that reads
   * rosters at one moment and contracts at another can show a payroll that
   * never existed.
   */
  async league(leagueId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: {
        id: true,
        name: true,
        logo: true,
        season: true,
        teamCount: true,
        visibility: true,
        settings: {
          select: {
            salaryCap: true,
            minPlayerSalary: true,
            minRosterSize: true,
            maxRosterSize: true,
            maxTwoWay: true,
            setupLocked: true,
            setupMode: true,
          },
        },
      },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const seasonStartYear =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();
    const effective = await this.capService.forLeague(
      leagueId,
      seasonStartYear,
    );
    const salaryCap = effective.salaryCap;

    const [
      teams,
      members,
      pendingInvites,
      leaguePlayers,
      contractYears,
      deadMoney,
      capHolds,
      pendingOffers,
      upcoming,
      calendarCount,
    ] = await Promise.all([
      this.prisma.team.findMany({
        where: { leagueId },
        select: {
          id: true,
          name: true,
          abbr: true,
          color: true,
          logo: true,
          members: { select: { role: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.leagueMember.count({ where: { leagueId } }),
      this.prisma.leagueInvite.count({
        where: { leagueId, status: LeagueInviteStatus.pending },
      }),
      this.prisma.leaguePlayer.findMany({
        where: { leagueId },
        select: { teamId: true, status: true, slotType: true },
      }),
      this.prisma.contractYear.findMany({
        where: {
          seasonStartYear,
          contract: { leagueId, isActive: true },
        },
        select: { capHit: true, contract: { select: { teamId: true } } },
      }),
      this.prisma.deadMoney.groupBy({
        by: ['teamId'],
        where: { leagueId, seasonStartYear },
        _sum: { amount: true },
      }),
      this.prisma.capHold.groupBy({
        by: ['teamId'],
        where: { leagueId, seasonStartYear },
        _sum: { amount: true },
      }),
      this.prisma.freeAgencyOffer.count({
        where: { leagueId, status: FreeAgencyOfferStatus.pending },
      }),
      this.prisma.leagueCalendarEvent.findMany({
        where: {
          leagueId,
          season: league.season,
          startDate: { gte: new Date() },
        },
        select: {
          id: true,
          title: true,
          phase: true,
          startDate: true,
          endDate: true,
          isApproximate: true,
          displayLabel: true,
        },
        orderBy: { startDate: 'asc' },
        take: UPCOMING_LIMIT,
      }),
      this.prisma.leagueCalendarEvent.count({
        where: { leagueId, season: league.season },
      }),
    ]);

    const payrollByTeam = new Map<number, number>();
    for (const year of contractYears) {
      const teamId = year.contract.teamId;
      payrollByTeam.set(teamId, (payrollByTeam.get(teamId) ?? 0) + year.capHit);
    }
    for (const row of deadMoney) {
      payrollByTeam.set(
        row.teamId,
        (payrollByTeam.get(row.teamId) ?? 0) + (row._sum.amount ?? 0),
      );
    }
    for (const row of capHolds) {
      payrollByTeam.set(
        row.teamId,
        (payrollByTeam.get(row.teamId) ?? 0) + (row._sum.amount ?? 0),
      );
    }

    const rosterByTeam = new Map<
      number,
      { standard: number; twoWay: number }
    >();
    for (const row of leaguePlayers) {
      if (row.teamId === null || row.status !== LeaguePlayerStatus.rostered) {
        continue;
      }
      const counts = rosterByTeam.get(row.teamId) ?? { standard: 0, twoWay: 0 };
      if (row.slotType === RosterSlotType.twoWay) counts.twoWay += 1;
      else if (row.slotType === RosterSlotType.standard) counts.standard += 1;
      rosterByTeam.set(row.teamId, counts);
    }

    const totals: TeamTotals[] = teams.map((team) => {
      const counts = rosterByTeam.get(team.id) ?? { standard: 0, twoWay: 0 };
      return {
        id: team.id,
        name: team.name,
        abbr: team.abbr,
        color: team.color,
        logo: team.logo,
        hasOwner: team.members.length > 0,
        rosterCount: counts.standard,
        twoWayCount: counts.twoWay,
        payroll: payrollByTeam.get(team.id) ?? 0,
      };
    });

    const rules = league.settings;
    const salaryFloor = effective.salaryFloor;

    // Only teams that have started filling a roster can be "below the floor".
    // An empty expansion team is not in breach of anything.
    const belowFloor =
      salaryCap > 0
        ? totals.filter(
            (team) => team.rosterCount > 0 && team.payroll < salaryFloor,
          )
        : [];

    const overRoster = rules
      ? totals.filter((team) => team.rosterCount > rules.maxRosterSize)
      : [];

    const withPayroll = totals.filter((team) => team.payroll > 0);
    const totalPayroll = totals.reduce((sum, team) => sum + team.payroll, 0);
    const contractedPlayers = contractYears.length;

    const ranked = [...withPayroll].sort((a, b) => b.payroll - a.payroll);

    return {
      league: {
        id: league.id,
        name: league.name,
        logo: league.logo,
        season: league.season,
        seasonStartYear,
        visibility: league.visibility,
        setupMode: league.settings?.setupMode ?? null,
        setupLocked: league.settings?.setupLocked ?? false,
      },

      // What is done and what is not, so a new commissioner can see where they
      // are without opening six pages to find out.
      setup: {
        teamsCreated: teams.length,
        teamCount: league.teamCount,
        membersJoined: members,
        pendingInvites,
        salaryCapSet: salaryCap > 0,
        rosterRulesSet: Boolean(rules),
        calendarEvents: calendarCount,
        playersImported: leaguePlayers.length,
      },

      teams: {
        total: teams.length,
        max: league.teamCount,
        withOwner: totals.filter((team) => team.hasOwner).length,
        withoutOwner: totals.filter((team) => !team.hasOwner),
      },

      players: {
        total: leaguePlayers.length,
        rostered: leaguePlayers.filter(
          (row) => row.status === LeaguePlayerStatus.rostered,
        ).length,
        freeAgents: leaguePlayers.filter(
          (row) => row.status === LeaguePlayerStatus.freeAgent,
        ).length,
        rightsHeld: leaguePlayers.filter(
          (row) => row.status === LeaguePlayerStatus.rightsHeld,
        ).length,
      },

      payroll: {
        salaryCap,
        salaryFloor: salaryCap > 0 ? salaryFloor : null,
        luxuryTax: salaryCap > 0 ? effective.luxuryTax : null,
        firstApron: salaryCap > 0 ? effective.firstApron : null,
        secondApron: salaryCap > 0 ? effective.secondApron : null,
        capSource: effective.source,
        total: totalPayroll,
        contractedPlayers,
        // Averaged over the teams that have a payroll at all. Dividing by
        // every team would report a number no team is near while half the
        // league is still empty.
        averageTeamPayroll:
          withPayroll.length > 0
            ? Math.round(totalPayroll / withPayroll.length)
            : null,
        averagePlayerSalary:
          contractedPlayers > 0
            ? Math.round(totalPayroll / contractedPlayers)
            : null,
        highest: ranked[0] ?? null,
        lowest: ranked.length > 1 ? ranked[ranked.length - 1] : null,
      },

      // Rule 3.5 keeps the salary floor out of this: it carries no penalty,
      // so it is reported under `tracking` and never as something to fix.
      tracking: {
        belowFloor: belowFloor.map((team) => ({
          id: team.id,
          name: team.name,
          abbr: team.abbr,
          payroll: team.payroll,
          salaryFloor,
        })),
      },

      attention: {
        pendingInvites,
        pendingOffers,
        teamsWithoutOwner: totals.filter((team) => !team.hasOwner).length,
        overRoster: overRoster.map((team) => ({
          id: team.id,
          name: team.name,
          abbr: team.abbr,
          rosterCount: team.rosterCount,
          maxRosterSize: rules?.maxRosterSize ?? null,
        })),
      },

      upcoming,
      teamTotals: totals,
    };
  }
}
