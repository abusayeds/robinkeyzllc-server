import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CalendarPhase,
  LeaguePlayerStatus,
  LeagueRole,
  Prisma,
  RosterSlotType,
  TradeAssetKind,
  TradeResponse,
  TradeStatus,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import { CapService } from '../cap/cap.service';
import { HardCapService } from '../cap/hard-cap.service';
import {
  HardCapTrigger,
  NotificationType,
  PickProtectionOutcome,
} from '@prisma/client';
import {
  UNTRADEABLE_MESSAGE,
  draftYearLabel,
  pickLabel,
  protectionLabel,
  roundLabel,
  untradeableReason,
} from '../draft/draft.rules';
import { APRON_LABEL } from '../cap/cap.hardcap';
import { NewsPublisher } from '../news/news.publisher';
import { NotificationService } from '../notification/notification.service';
import { maxIncomingSalary } from '../cap/cap.tiers';
import { EvaluateTradeDto } from './dto/evaluate-trade.dto';
import { ProposeTradeDto, TradeAssetDto } from './dto/propose-trade.dto';
import {
  blockingChecks,
  checkTrade,
  committedAfter,
  exceptionFor,
  exceptionSpend,
  rosterAfter,
  shortTeamName,
  TIER_LABEL,
  tierFor,
  TradeCheck,
  TradeSide,
  tradeIsLegal,
  twoWayAfter,
} from './trade.rules';

/** One threshold measured against where a team lands, for the builder cards. */
const capLine = (label: string, threshold: number, salary: number) => ({
  label,
  threshold,
  difference: Math.abs(salary - threshold),
  isOver: salary > threshold,
});

/** How long an exception earned in a trade lasts. */
const EXCEPTION_DAYS = 365;

/** Rule 12.1 — seven drafts ahead, unless the commissioner has changed it. */
const DEFAULT_PICK_WINDOW = 7;

const TRADE_SELECT = {
  id: true,
  leagueId: true,
  status: true,
  requiresApproval: true,
  checks: true,
  message: true,
  rejectedReason: true,
  approvedAt: true,
  processedAt: true,
  createdAt: true,
  proposedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  teams: {
    select: {
      id: true,
      teamId: true,
      response: true,
      respondedAt: true,
      team: {
        select: { id: true, name: true, abbr: true, color: true, logo: true },
      },
      respondedBy: { select: { id: true, name: true } },
    },
  },
  assets: {
    select: {
      id: true,
      kind: true,
      fromTeamId: true,
      toTeamId: true,
      salary: true,
      // The terms as they were agreed in this trade, which is what a detail
      // should show even after the pick itself has moved on.
      protectedTopN: true,
      protectionOutcome: true,
      protectionFinalYear: true,
      protectionNote: true,
      leaguePlayer: {
        select: {
          id: true,
          tradeAcquiredAt: true,
          // Rule 4.9 — a two-way player holds no standard roster spot, so
          // every re-judge of a trade has to know which kind he is.
          slotType: true,
          player: { select: { id: true, name: true, position: true } },
        },
      },
      tradeException: { select: { id: true, label: true, remaining: true } },
      draftPick: {
        select: {
          id: true,
          seasonStartYear: true,
          round: true,
          protectedTopN: true,
          originalTeam: { select: { id: true, abbr: true } },
        },
      },
    },
  },
} satisfies Prisma.TradeSelect;

type TradeRow = Prisma.TradeGetPayload<{ select: typeof TRADE_SELECT }>;

@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cap: CapService,
    private readonly hardCap: HardCapService,
    private readonly news: NewsPublisher,
    private readonly notifications: NotificationService,
  ) {}

  async list(leagueId: number, status?: TradeStatus, teamId?: number) {
    const trades = await this.prisma.trade.findMany({
      where: {
        leagueId,
        ...(status ? { status } : {}),
        ...(teamId ? { teams: { some: { teamId } } } : {}),
      },
      select: TRADE_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return trades.map((trade) => this.toTrade(trade));
  }

  async findOne(leagueId: number, tradeId: number) {
    const trade = await this.prisma.trade.findFirst({
      where: { id: tradeId, leagueId },
      select: TRADE_SELECT,
    });
    if (!trade) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Trade not found');
    }

    // The detail is judged again, now, rather than replaying whatever the
    // proposal said: a roster or a contract may have moved since, and an
    // owner deciding whether to accept needs today's numbers. A trade that
    // has already been processed is left alone, because its sides no longer
    // describe anything that could happen.
    const settled =
      trade.status === TradeStatus.processed ||
      trade.status === TradeStatus.approved;

    let evaluation: ReturnType<TradeService['judge']> | null = null;
    if (!settled) {
      const league = await this.leagueState(leagueId);
      const teams = trade.teams.map((row) => row.team);
      const sides = await this.buildSides(
        leagueId,
        teams,
        trade.assets.map((asset) => ({
          kind: asset.kind,
          fromTeamId: asset.fromTeamId,
          toTeamId: asset.toTeamId,
          salary: asset.salary,
          leaguePlayerId: asset.leaguePlayer?.id ?? null,
          playerName: asset.leaguePlayer?.player.name ?? null,
          tradeAcquiredAt: asset.leaguePlayer?.tradeAcquiredAt ?? null,
          slotType: asset.leaguePlayer?.slotType ?? null,
          tradeExceptionId: asset.tradeException?.id ?? null,
        })),
        league,
      );
      evaluation = this.judge(sides, teams, league);
    }

    return { ...this.toTrade(trade), evaluation };
  }

  /**
   * Proposes a trade.
   *
   * An illegal trade is recorded rather than refused, the same way an illegal
   * free agency offer is: the commissioner decides what to do about it, and a
   * proposal that silently never existed is harder to argue about than one
   * marked as failing.
   */
  async propose(leagueId: number, userId: number, payload: ProposeTradeDto) {
    const teamIds = [
      ...new Set(payload.assets.flatMap((a) => [a.fromTeamId, a.toTeamId])),
    ];
    if (teamIds.length < 2) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'A trade needs at least two teams.',
      );
    }

    const teams = await this.prisma.team.findMany({
      where: { id: { in: teamIds }, leagueId },
      select: { id: true, name: true, abbr: true },
    });
    if (teams.length !== teamIds.length) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'One of those teams is not in this league.',
      );
    }

    // The proposer must hold one of the teams, or run the league. Without
    // this any member could propose a deal between two teams they have
    // nothing to do with.
    const proposerTeamId = await this.assertMayPropose(
      leagueId,
      teamIds,
      userId,
    );

    const league = await this.leagueState(leagueId);
    const assets = await this.resolveAssets(leagueId, payload, league);
    const sides = await this.buildSides(leagueId, teams, assets, league);

    const checks = checkTrade(sides, {
      cap: league.cap,
      salaryMatching: league.salaryMatching,
      apronRules: league.apronRules,
      deadlinePassed: league.deadlinePassed,
      deadlineLabel: league.deadlineLabel,
      rosterMinimum: league.rosterMinimum,
      rookieMinimum: league.rookieMinimum,
    });

    const trade = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trade.create({
        data: {
          leagueId,
          proposedById: userId,
          message: payload.message?.trim() || null,
          requiresApproval: league.commissionerTradeApproval,
          checks: checks as unknown as Prisma.InputJsonValue,
          teams: {
            create: teams.map((team) => ({
              teamId: team.id,
              // The proposing team has said yes by proposing.
              response:
                team.id === proposerTeamId
                  ? TradeResponse.accepted
                  : TradeResponse.pending,
              respondedById: team.id === proposerTeamId ? userId : null,
              respondedAt: team.id === proposerTeamId ? new Date() : null,
            })),
          },
          assets: {
            create: assets.map((asset) => ({
              kind: asset.kind,
              fromTeamId: asset.fromTeamId,
              toTeamId: asset.toTeamId,
              leaguePlayerId: asset.leaguePlayerId,
              tradeExceptionId: asset.tradeExceptionId,
              draftPickId: asset.draftPickId,
              salary: asset.salary,
              protectedTopN: asset.protectedTopN,
              protectionOutcome: asset.protectionOutcome,
              protectionFinalYear: asset.protectionFinalYear,
              protectionNote: asset.protectionNote,
            })),
          },
        },
        select: { id: true },
      });
      return created;
    });

    // The bell, as well as the dashboard. An offer showed up on one screen
    // and nowhere else, so an owner only found out by going looking.
    await this.notifyRecipients(leagueId, trade.id, teamIds, proposerTeamId);

    return this.findOne(leagueId, trade.id);
  }

  /**
   * Tells the other owners an offer is waiting.
   *
   * Outside the transaction and never allowed to throw: a trade that was
   * written must not be undone because a notification row failed.
   */
  private async notifyRecipients(
    leagueId: number,
    tradeId: number,
    teamIds: number[],
    proposerTeamId: number | null,
  ) {
    try {
      const [holders, league] = await Promise.all([
        this.prisma.teamMember.findMany({
          where: {
            leagueId,
            teamId: { in: teamIds.filter((id) => id !== proposerTeamId) },
          },
          select: {
            userId: true,
            team: { select: { name: true, abbr: true } },
          },
        }),
        this.prisma.league.findUnique({
          where: { id: leagueId },
          select: { name: true },
        }),
      ]);

      if (holders.length === 0) return;

      await this.notifications.notifyMany(
        holders.map((holder) => ({
          userId: holder.userId,
          type: NotificationType.tradeProposal,
          title: 'New trade offer',
          detail: `${holder.team.name} has a trade offer waiting in ${league?.name ?? 'your league'}.`,
          leagueId,
          link: '/my-team/trade-center',
        })),
      );
    } catch {
      // Swallowed on purpose: see the note above.
    }
  }

  /**
   * The same judgement as proposing, with nothing written.
   *
   * The builder asks again on every change, so this one is allowed to be
   * handed a trade that is not finished: the checks come back as they stand.
   * The cap lines come back for every team on screen, sending or not, because
   * a card has numbers to show before anything has been picked from it.
   */
  async evaluate(leagueId: number, userId: number, payload: EvaluateTradeDto) {
    const teamIds = [
      ...new Set([
        ...payload.teamIds,
        ...payload.assets.flatMap((asset) => [
          asset.fromTeamId,
          asset.toTeamId,
        ]),
      ]),
    ];
    if (teamIds.length < 2) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'A trade needs at least two teams.',
      );
    }

    const teams = await this.prisma.team.findMany({
      where: { id: { in: teamIds }, leagueId },
      select: { id: true, name: true, abbr: true },
    });
    if (teams.length !== teamIds.length) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'One of those teams is not in this league.',
      );
    }

    await this.assertMayPropose(leagueId, teamIds, userId);

    const league = await this.leagueState(leagueId);
    const assets = await this.resolveAssets(leagueId, payload, league);
    const sides = await this.buildSides(leagueId, teams, assets, league);

    return this.judge(sides, teams, league);
  }

  /**
   * The verdict on a set of sides: every rule, and the numbers each team's
   * card shows.
   *
   * Shared by the dry run and by a trade's own detail, so the figures an owner
   * reads on a pending offer are the same ones the builder showed and are
   * worked out by the same code.
   */
  private judge(
    sides: TradeSide[],
    teams: { id: number; abbr: string }[],
    league: Awaited<ReturnType<TradeService['leagueState']>>,
  ) {
    const checks = checkTrade(sides, {
      cap: league.cap,
      salaryMatching: league.salaryMatching,
      apronRules: league.apronRules,
      deadlinePassed: league.deadlinePassed,
      deadlineLabel: league.deadlineLabel,
      rosterMinimum: league.rosterMinimum,
      rookieMinimum: league.rookieMinimum,
    });

    const cap = league.cap;
    const abbrOf = new Map(teams.map((team) => [team.id, team.abbr]));

    return {
      isLegal: tradeIsLegal(checks),
      capIsSet: cap.isSet,
      salaryMatching: league.salaryMatching,
      apronRules: league.apronRules,
      deadlinePassed: league.deadlinePassed,
      deadlineLabel: league.deadlineLabel,
      checks,
      teams: sides.map((side) => {
        const after = committedAfter(side);
        const tierBefore = tierFor(side.committed, cap);
        const tier = tierFor(after, cap);
        const matching = league.salaryMatching
          ? maxIncomingSalary({
              outgoing: side.outgoing,
              tierAfter: tier,
              cap,
              capRoomBefore: cap.salaryCap - side.committed,
              wasBelowCapBefore: side.committed < cap.salaryCap,
            })
          : null;

        return {
          teamId: side.teamId,
          teamName: side.teamName,
          teamAbbr: abbrOf.get(side.teamId) ?? null,
          shortName: side.shortName,
          tier,
          tierLabel: TIER_LABEL[tier],
          // The card leads with the move, not the destination, so it needs
          // both ends of it.
          tierBefore,
          tierBeforeLabel: TIER_LABEL[tierBefore],
          tierChanged: tier !== tierBefore,
          playersIn: side.incomingPlayers.length,
          playersOut: side.outgoingPlayers.length,
          incoming: side.incoming,
          outgoing: side.outgoing,
          salaryBefore: side.committed,
          salaryAfter: after,
          // Net salary used to be reported alongside this and always equalled
          // it, so only the one name is kept.
          capImpact: after - side.committed,
          rosterBefore: side.rosterCount,
          rosterAfter: rosterAfter(side),
          maxRosterSize: side.maxRosterSize,
          rosterMinimum: league.rosterMinimum,
          // Rule 4.9 — the two-way pool is its own line, never folded into
          // the 15.
          twoWayBefore: side.twoWayCount,
          twoWayAfter: twoWayAfter(side),
          maxTwoWay: side.maxTwoWay,
          // Each line is measured from where this team lands, so the card
          // can say "$800,000 Over" without doing the arithmetic itself.
          lines: [
            capLine('Salary Cap', cap.salaryCap, after),
            capLine('Luxury Tax', cap.luxuryTax, after),
            capLine('First Apron', cap.firstApron, after),
            capLine('Second Apron', cap.secondApron, after),
          ],
          maxIncoming: matching?.limit ?? null,
          maxIncomingRule: matching?.ruleName ?? null,
          maxIncomingFormula: matching?.formula ?? null,
          hardCap: side.hardCap
            ? {
                label: APRON_LABEL[side.hardCap.apron],
                amount: side.hardCap.amount,
                trigger: side.hardCap.trigger,
              }
            : null,
        };
      }),
    };
  }

  /** A team answers. The last yes moves the trade on. */
  async respond(
    leagueId: number,
    tradeId: number,
    teamId: number,
    userId: number,
    accept: boolean,
  ) {
    const trade = await this.prisma.trade.findFirst({
      where: { id: tradeId, leagueId },
      select: { id: true, status: true, requiresApproval: true, teams: true },
    });
    if (!trade) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Trade not found');
    }
    if (trade.status !== TradeStatus.proposed) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This trade is no longer open for an answer.',
      );
    }

    const side = trade.teams.find((row) => row.teamId === teamId);
    if (!side) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'That team is not in this trade.',
      );
    }
    await this.assertMayManage(leagueId, teamId, userId);

    await this.prisma.tradeTeam.update({
      where: { id: side.id },
      data: {
        response: accept ? TradeResponse.accepted : TradeResponse.declined,
        respondedById: userId,
        respondedAt: new Date(),
      },
    });

    if (!accept) {
      await this.prisma.trade.update({
        where: { id: tradeId },
        data: { status: TradeStatus.declined },
      });
      return this.findOne(leagueId, tradeId);
    }

    const answers = await this.prisma.tradeTeam.findMany({
      where: { tradeId },
      select: { response: true },
    });
    const allAccepted = answers.every(
      (row) => row.response === TradeResponse.accepted,
    );

    if (allAccepted) {
      if (trade.requiresApproval) {
        await this.prisma.trade.update({
          where: { id: tradeId },
          data: { status: TradeStatus.awaitingApproval },
        });
      } else {
        // The league's setting says trades process automatically once every
        // team accepts, so nothing waits for a commissioner.
        await this.process(leagueId, tradeId);
      }
    }

    return this.findOne(leagueId, tradeId);
  }

  async withdraw(leagueId: number, tradeId: number, userId: number) {
    const trade = await this.prisma.trade.findFirst({
      where: { id: tradeId, leagueId },
      select: { id: true, status: true, proposedById: true },
    });
    if (!trade) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Trade not found');
    }
    if (trade.proposedById !== userId) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'Only the team that proposed a trade can withdraw it.',
      );
    }
    if (
      trade.status !== TradeStatus.proposed &&
      trade.status !== TradeStatus.awaitingApproval
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This trade can no longer be withdrawn.',
      );
    }

    await this.prisma.trade.update({
      where: { id: tradeId },
      data: { status: TradeStatus.withdrawn },
    });
    return this.findOne(leagueId, tradeId);
  }

  async reject(
    leagueId: number,
    tradeId: number,
    userId: number,
    reason?: string,
  ) {
    const trade = await this.prisma.trade.findFirst({
      where: { id: tradeId, leagueId },
      select: { id: true, status: true },
    });
    if (!trade) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Trade not found');
    }
    if (trade.status !== TradeStatus.awaitingApproval) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Only a trade waiting for approval can be rejected.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.trade.update({
        where: { id: tradeId },
        data: {
          status: TradeStatus.rejected,
          approvedById: userId,
          approvedAt: new Date(),
          rejectedReason: reason?.trim() || null,
        },
      });

      // A trade the commissioner turned down is league news too: the owners
      // who agreed it will want to know why, and from one place.
      const sides = await tx.tradeTeam.findMany({
        where: { tradeId },
        select: {
          teamId: true,
          team: { select: { name: true, abbr: true, logo: true } },
        },
      });

      await this.news.publishVeto(tx, {
        leagueId,
        tradeId,
        reason: reason?.trim() || null,
        teams: sides.map((side) => ({
          teamId: side.teamId,
          name: side.team.name,
          abbr: side.team.abbr,
          logo: side.team.logo,
        })),
      });
    });

    return this.findOne(leagueId, tradeId);
  }

  async approve(leagueId: number, tradeId: number, userId: number) {
    const trade = await this.prisma.trade.findFirst({
      where: { id: tradeId, leagueId },
      select: { id: true, status: true },
    });
    if (!trade) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Trade not found');
    }
    if (trade.status !== TradeStatus.awaitingApproval) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Only a trade waiting for approval can be approved.',
      );
    }

    await this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        status: TradeStatus.approved,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });

    return this.process(leagueId, tradeId);
  }

  /**
   * Moves everything. One transaction, because a trade that half happened is
   * worse than one that did not: a player on two rosters, or on none.
   */
  private async process(leagueId: number, tradeId: number) {
    const trade = await this.prisma.trade.findFirstOrThrow({
      where: { id: tradeId, leagueId },
      select: {
        id: true,
        assets: {
          select: {
            kind: true,
            fromTeamId: true,
            toTeamId: true,
            salary: true,
            leaguePlayerId: true,
            tradeExceptionId: true,
            draftPickId: true,
            protectedTopN: true,
            protectionOutcome: true,
            protectionFinalYear: true,
            protectionNote: true,
            // Read for the League News post written at the end of this
            // method, which names the players and picks that moved.
            leaguePlayer: {
              select: {
                id: true,
                tradeAcquiredAt: true,
                slotType: true,
                player: { select: { name: true, position: true } },
                contracts: {
                  where: { isActive: true },
                  select: { endSeasonStartYear: true },
                  take: 1,
                },
              },
            },
            draftPick: {
              select: {
                seasonStartYear: true,
                round: true,
                originalTeam: { select: { abbr: true } },
              },
            },
          },
        },
        teams: {
          select: {
            teamId: true,
            team: {
              select: { id: true, name: true, abbr: true, logo: true },
            },
          },
        },
      },
    });

    // The last season of each moving player's deal, for the terms a post
    // shows beside his name. Read before the contracts are reassigned.
    const endSeasonByPlayer = new Map<string, number | null>(
      trade.assets
        .filter((asset) => asset.leaguePlayer)
        .map((asset) => [
          asset.leaguePlayer!.player.name,
          asset.leaguePlayer!.contracts[0]?.endSeasonStartYear ?? null,
        ]),
    );

    const league = await this.leagueState(leagueId);
    const expiresAt = new Date(
      Date.now() + EXCEPTION_DAYS * 24 * 60 * 60 * 1000,
    );

    // Rule 5.9 exempts a player absorbed into cap room, so the two-month
    // clock is only started for teams that had to match salaries. Worked out
    // before anything moves, because afterwards the payroll it is judged on
    // has already changed.
    // buildSides wants the player details flat; the trade rows carry them
    // nested under leaguePlayer.
    const assetsForRules = trade.assets.map((asset) => ({
      kind: asset.kind,
      fromTeamId: asset.fromTeamId,
      toTeamId: asset.toTeamId,
      salary: asset.salary,
      leaguePlayerId: asset.leaguePlayerId,
      playerName: asset.leaguePlayer?.player.name ?? null,
      tradeAcquiredAt: asset.leaguePlayer?.tradeAcquiredAt ?? null,
      slotType: asset.leaguePlayer?.slotType ?? null,
      tradeExceptionId: asset.tradeExceptionId,
    }));

    const sidesBefore = await this.buildSides(
      leagueId,
      trade.teams.map((row) => row.team),
      assetsForRules,
      league,
    );

    // Judged again here, not only when the offer was written.
    //
    // An offer is deliberately allowed to be recorded while it breaks a rule,
    // so a commissioner can see what was attempted. Processing it is a
    // different thing: this is the moment the players actually move, and
    // between the proposal and the last acceptance a team can sign, waive or
    // trade someone else and turn a legal deal into an illegal one. Rule 4.3
    // in particular blocks every move that would leave a team over its hard
    // cap, so the ceiling has to be measured against the rosters as they are
    // now.
    const ruleContext = {
      cap: league.cap,
      salaryMatching: league.salaryMatching,
      apronRules: league.apronRules,
      deadlinePassed: league.deadlinePassed,
      deadlineLabel: league.deadlineLabel,
      rosterMinimum: league.rosterMinimum,
      rookieMinimum: league.rookieMinimum,
    };
    const finalChecks = checkTrade(sidesBefore, ruleContext);

    if (!tradeIsLegal(finalChecks)) {
      const blocking = blockingChecks(finalChecks);
      await this.prisma.trade.update({
        where: { id: tradeId },
        data: {
          status: TradeStatus.rejected,
          rejectedReason:
            blocking[0]?.label ?? 'This trade breaks a league rule.',
          checks: finalChecks as unknown as Prisma.InputJsonValue,
        },
      });
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        blocking.length === 1
          ? blocking[0].label
          : `This trade can no longer be processed: ${blocking
              .map((check) => check.label)
              .join('; ')}.`,
      );
    }

    const absorbing = new Set(
      sidesBefore
        .filter(
          (side) =>
            maxIncomingSalary({
              outgoing: side.outgoing,
              tierAfter: tierFor(committedAfter(side), league.cap),
              cap: league.cap,
              capRoomBefore: league.cap.salaryCap - side.committed,
              wasBelowCapBefore: side.committed < league.cap.salaryCap,
            }).usedCapRoom,
        )
        .map((side) => side.teamId),
    );
    const acquiredAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const asset of trade.assets) {
        if (asset.kind === TradeAssetKind.player && asset.leaguePlayerId) {
          await tx.leaguePlayer.update({
            where: { id: asset.leaguePlayerId },
            data: {
              teamId: asset.toTeamId,
              // Rule 5.9 — the two-month aggregation wait runs from here.
              tradeAcquiredAt: absorbing.has(asset.toTeamId)
                ? null
                : acquiredAt,
            },
          });
          await tx.contract.updateMany({
            where: { leaguePlayerId: asset.leaguePlayerId, isActive: true },
            data: { teamId: asset.toTeamId },
          });
        }

        if (
          asset.kind === TradeAssetKind.tradeException &&
          asset.tradeExceptionId &&
          asset.toTeamId !== asset.fromTeamId
        ) {
          // Rule 7.5 — an exception does not split when it is traded; the
          // whole remaining balance changes hands.
          await tx.tradeException.update({
            where: { id: asset.tradeExceptionId },
            data: { teamId: asset.toTeamId },
          });
        }

        if (asset.kind === TradeAssetKind.draftPick && asset.draftPickId) {
          // Only `currentTeamId` moves. `originalTeamId` never does: every
          // protection and the back-to-back rule are read against the team
          // the pick was born to.
          // Rules 12.5-12.7 — the terms travel with the pick. `owedToTeamId`
          // points at the team the protection owes it to, which matters while
          // a protection holds and the original team keeps the pick.
          await tx.draftPick.update({
            where: { id: asset.draftPickId },
            data: {
              currentTeamId: asset.toTeamId,
              protectedTopN: asset.protectedTopN,
              protectionOutcome: asset.protectionOutcome,
              protectionFinalYear: asset.protectionFinalYear,
              owedToTeamId:
                asset.protectedTopN !== null ? asset.toTeamId : null,
              ...(asset.protectionNote ? { note: asset.protectionNote } : {}),
            },
          });

          // Rule 12.10 — both teams' pick pages show the terms and the
          // current status, which means the trail has to be kept.
          await tx.draftPickEvent.create({
            data: {
              pickId: asset.draftPickId,
              fromTeamId: asset.fromTeamId,
              toTeamId: asset.toTeamId,
              tradeId: trade.id,
              reason: `Trade #${trade.id}`,
            },
          });
        }
      }

      // Rule 7.4 — what an exception absorbed comes off its balance, and an
      // exception with nothing left is retired rather than deleted, so the
      // trade that spent it still has something to point at.
      for (const side of sidesBefore) {
        for (const spent of exceptionSpend(side, ruleContext)) {
          const row = side.exceptions.find((one) => one.id === spent.id);
          const left = Math.max(0, (row?.remaining ?? 0) - spent.absorbed);
          await tx.tradeException.update({
            where: { id: spent.id },
            data: { remaining: left, isActive: left > 0 },
          });
        }
      }

      // Exceptions are created from what actually moved, after the moves, so
      // a trade edited between proposal and approval cannot mint one from
      // figures that are no longer true.
      for (const row of trade.teams) {
        const out = trade.assets.filter((a) => a.fromTeamId === row.teamId);
        const outgoingSalaries = out
          .filter((a) => a.kind === TradeAssetKind.player)
          .map((a) => a.salary);
        const incoming = trade.assets
          .filter((a) => a.toTeamId === row.teamId)
          .reduce((sum, a) => sum + a.salary, 0);

        const value = exceptionFor({
          largestOutgoing:
            outgoingSalaries.length > 0 ? Math.max(...outgoingSalaries) : 0,
          incoming,
        });

        // Rule 4.2 — the ceiling is bought by the move, so it is written
        // with the move. The checks at proposal time already refused a trade
        // that could not carry it.
        if (league.apronRules) {
          const triggers: HardCapTrigger[] = [];
          if (incoming > out.reduce((sum, a) => sum + a.salary, 0)) {
            triggers.push(HardCapTrigger.tookBackMoreSalary);
          }
          if (outgoingSalaries.length > 1) {
            triggers.push(HardCapTrigger.aggregatedSalaries);
          }

          for (const trigger of triggers) {
            await this.hardCap.apply({
              leagueId,
              teamId: row.teamId,
              seasonStartYear: league.seasonStartYear,
              trigger,
              cap: league.cap,
              sourceTradeId: trade.id,
              tx,
            });
          }
        }

        if (value !== null && league.allowTradeExceptions) {
          await tx.tradeException.create({
            data: {
              leagueId,
              teamId: row.teamId,
              label: `Trade #${trade.id}`,
              amount: value,
              remaining: value,
              expiresAt,
              sourceTradeId: trade.id,
            },
          });
        }
      }

      const processedAt = new Date();

      await tx.trade.update({
        where: { id: tradeId },
        data: { status: TradeStatus.processed, processedAt },
      });

      // Inside the same transaction: a trade that rolls back must not leave a
      // post behind saying it happened. The cap figures come from the sides
      // read before anything moved, which is the only moment "before" is true.
      await this.news.publishTrade(tx, {
        leagueId,
        tradeId,
        seasonStartYear: league.seasonStartYear,
        salaryCap: league.cap.salaryCap,
        teams: sidesBefore.map((side) => {
          const team = trade.teams.find(
            (row) => row.teamId === side.teamId,
          )?.team;
          return {
            teamId: side.teamId,
            name: side.teamName,
            abbr: side.teamAbbr,
            logo: team?.logo ?? null,
            capBefore: side.committed,
            capAfter: committedAfter(side),
          };
        }),
        assets: trade.assets.map((asset) => ({
          kind: asset.kind,
          toTeamId: asset.toTeamId,
          salary: asset.salary,
          player: asset.leaguePlayer
            ? {
                name: asset.leaguePlayer.player.name,
                position: asset.leaguePlayer.player.position,
              }
            : null,
          pick: asset.draftPick
            ? {
                seasonStartYear: asset.draftPick.seasonStartYear,
                round: asset.draftPick.round,
                originalTeamAbbr: asset.draftPick.originalTeam.abbr,
              }
            : null,
        })),
        throughByPlayer: endSeasonByPlayer,
        processedAt,
      });
    });

    return this.findOne(leagueId, tradeId);
  }

  async exceptions(leagueId: number, teamId?: number) {
    return this.prisma.tradeException.findMany({
      where: {
        leagueId,
        isActive: true,
        ...(teamId ? { teamId } : {}),
      },
      select: {
        id: true,
        label: true,
        amount: true,
        remaining: true,
        // Rule 7.3 — one year from creation, so the contracts page can say
        // both when it was earned and how long is left on it.
        createdAt: true,
        expiresAt: true,
        team: { select: { id: true, name: true, abbr: true } },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  /**
   * A commissioner records a Traded Player Exception by hand.
   *
   * Article 7 creates an exception out of a trade, and `process()` writes
   * those itself — nothing here replaces that. This exists for the ones that
   * did not come from a trade processed in this app: a league carried over
   * from somewhere else, or a deal settled off the record. Without it those
   * could not be entered at all, and a team would be short an asset it really
   * holds.
   *
   * Rule 7.4 — an exception is not a trade, so nothing about the team's cap
   * position is checked here. It is only usable inside one.
   */
  async createException(
    leagueId: number,
    payload: {
      teamId: number;
      amount: number;
      remaining?: number;
      expiresAt?: string;
      label?: string;
    },
  ) {
    const league = await this.leagueState(leagueId);
    if (!league.allowTradeExceptions) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This league has trade exceptions turned off.',
      );
    }

    const team = await this.prisma.team.findFirst({
      where: { id: payload.teamId, leagueId },
      select: { id: true, name: true, abbr: true },
    });
    if (!team) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'That team is not in this league.',
      );
    }

    const remaining = payload.remaining ?? payload.amount;
    if (remaining > payload.amount) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'An exception cannot have more left than it was worth.',
      );
    }

    // Rule 7.2 — a year, unless the commissioner names the date the original
    // trade set.
    const expiresAt = payload.expiresAt
      ? new Date(payload.expiresAt)
      : new Date(Date.now() + EXCEPTION_DAYS * 24 * 60 * 60 * 1000);

    if (Number.isNaN(expiresAt.getTime())) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'That expiry date is not a date.',
      );
    }

    return this.prisma.tradeException.create({
      data: {
        leagueId,
        teamId: team.id,
        label: payload.label?.trim() || `${team.abbr} Trade Exception`,
        amount: payload.amount,
        remaining,
        expiresAt,
        // No source trade: that is the whole point of entering one by hand.
        sourceTradeId: null,
      },
      select: {
        id: true,
        label: true,
        amount: true,
        remaining: true,
        expiresAt: true,
        team: { select: { id: true, name: true, abbr: true } },
      },
    });
  }

  /**
   * A commissioner retires an exception.
   *
   * Deactivated rather than deleted: a trade that already used part of it
   * points at this row, and removing it would leave that trade describing an
   * asset that no longer exists.
   */
  async retireException(leagueId: number, exceptionId: number) {
    const existing = await this.prisma.tradeException.findFirst({
      where: { id: exceptionId, leagueId },
      select: { id: true, isActive: true },
    });
    if (!existing) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Trade exception not found');
    }

    await this.prisma.tradeException.update({
      where: { id: existing.id },
      data: { isActive: false },
    });

    return { id: existing.id, isActive: false };
  }

  private async resolveAssets(
    leagueId: number,
    payload: ProposeTradeDto,
    league: Awaited<ReturnType<TradeService['leagueState']>>,
  ) {
    const seasonStartYear = (await this.leagueState(leagueId)).seasonStartYear;
    const resolved: {
      kind: TradeAssetKind;
      fromTeamId: number;
      toTeamId: number;
      leaguePlayerId: number | null;
      tradeExceptionId: number | null;
      draftPickId: number | null;
      salary: number;
      /** Only on players, for the rule messages that name them. */
      playerName: string | null;
      /** Rule 5.9 — when a trade last brought this player in. */
      tradeAcquiredAt: Date | null;
      /** Rule 4.9 — a two-way player holds no standard roster spot. */
      slotType: RosterSlotType | null;
      /** Rules 12.5-12.7 — the terms agreed on a pick in this trade. */
      protectedTopN: number | null;
      protectionOutcome: PickProtectionOutcome | null;
      protectionFinalYear: number | null;
      protectionNote: string | null;
    }[] = [];

    // Loaded once, and only if a pick is actually in the deal: the
    // back-to-back rule is a question about the original team's *other*
    // drafts, so it cannot be answered from the one pick being moved.
    let pickContext: Awaited<ReturnType<typeof this.pickTradingState>> | null =
      null;

    for (const asset of payload.assets) {
      if (asset.fromTeamId === asset.toTeamId) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'An asset cannot be sent to the team that already holds it.',
        );
      }

      if (asset.kind === TradeAssetKind.player) {
        if (!asset.leaguePlayerId) {
          throw new AppError(
            HttpStatus.BAD_REQUEST,
            'A player asset needs a player.',
          );
        }
        const row = await this.prisma.leaguePlayer.findFirst({
          where: {
            id: asset.leaguePlayerId,
            leagueId,
            teamId: asset.fromTeamId,
          },
          select: {
            id: true,
            tradeAcquiredAt: true,
            slotType: true,
            player: { select: { name: true } },
            contracts: {
              where: { isActive: true },
              select: {
                years: {
                  where: { seasonStartYear },
                  select: { capHit: true },
                },
              },
              take: 1,
            },
          },
        });
        if (!row) {
          throw new AppError(
            HttpStatus.BAD_REQUEST,
            'That player is not on the team sending him.',
          );
        }

        resolved.push({
          kind: TradeAssetKind.player,
          fromTeamId: asset.fromTeamId,
          toTeamId: asset.toTeamId,
          leaguePlayerId: row.id,
          tradeExceptionId: null,
          draftPickId: null,
          salary: row.contracts[0]?.years[0]?.capHit ?? 0,
          playerName: row.player.name,
          tradeAcquiredAt: row.tradeAcquiredAt,
          slotType: row.slotType,
          protectedTopN: null,
          protectionOutcome: null,
          protectionFinalYear: null,
          protectionNote: null,
        });
        continue;
      }

      if (asset.kind === TradeAssetKind.draftPick) {
        if (!asset.draftPickId) {
          throw new AppError(
            HttpStatus.BAD_REQUEST,
            'A draft pick asset needs a pick.',
          );
        }

        pickContext ??= await this.pickTradingState(leagueId, seasonStartYear);

        const pick = pickContext.picks.find(
          (row) => row.id === asset.draftPickId,
        );
        if (!pick || pick.currentTeamId !== asset.fromTeamId) {
          throw new AppError(
            HttpStatus.BAD_REQUEST,
            'That draft pick does not belong to the team sending it.',
          );
        }

        // Rule 12.11 — frozen, outside the window, owed under a protection or
        // breaking the back-to-back rule. The message the owner already sees
        // on the Draft Picks page is the one they get back here.
        const reason = untradeableReason(pick, pickContext.picks, {
          currentSeasonStartYear: seasonStartYear,
          windowDrafts: pickContext.windowDrafts,
          allowDraftPickTrading: pickContext.allowDraftPickTrading,
        });
        if (reason) {
          throw new AppError(
            HttpStatus.BAD_REQUEST,
            `${draftYearLabel(pick.seasonStartYear)} ${roundLabel(pick.round)}: ${UNTRADEABLE_MESSAGE[reason]}`,
          );
        }

        resolved.push({
          kind: TradeAssetKind.draftPick,
          fromTeamId: asset.fromTeamId,
          toTeamId: asset.toTeamId,
          leaguePlayerId: null,
          tradeExceptionId: null,
          draftPickId: pick.id,
          // A pick carries no salary into the matching sum. It is an asset,
          // not money owed — the same reason an exception carries none.
          salary: 0,
          playerName: null,
          tradeAcquiredAt: null,
          slotType: null,
          ...this.pickProtection(asset, pick.seasonStartYear),
        });
        continue;
      }

      if (!asset.tradeExceptionId) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'An exception asset needs an exception.',
        );
      }
      const exception = await this.prisma.tradeException.findFirst({
        where: {
          id: asset.tradeExceptionId,
          leagueId,
          teamId: asset.fromTeamId,
          isActive: true,
        },
        select: { id: true, remaining: true, expiresAt: true },
      });
      if (!exception) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'That exception does not belong to the team sending it.',
        );
      }
      if (exception.expiresAt < new Date()) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'That exception has expired.',
        );
      }

      // Rule 7.4 against Rule 7.5. An exception kept by its holder is being
      // used to absorb salary; one pointed at another team is being traded,
      // which is a commissioner setting and off in some leagues. The two are
      // told apart by where the asset lands, so neither needs a flag.
      if (
        asset.toTeamId !== asset.fromTeamId &&
        !league.allowTradingTradeExceptions
      ) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'This league does not allow trade exceptions to be traded. A team can still use its own to take a player in.',
        );
      }

      resolved.push({
        kind: TradeAssetKind.tradeException,
        fromTeamId: asset.fromTeamId,
        toTeamId: asset.toTeamId,
        leaguePlayerId: null,
        tradeExceptionId: exception.id,
        draftPickId: null,
        // An exception carries no salary into the matching sum: it is room,
        // not money owed.
        salary: 0,
        playerName: null,
        tradeAcquiredAt: null,
        slotType: null,
        protectedTopN: null,
        protectionOutcome: null,
        protectionFinalYear: null,
        protectionNote: null,
      });
    }

    return resolved;
  }

  /**
   * Rules 12.5-12.7 — the protection two owners agreed on for one pick.
   *
   * A protection without an outcome is an obligation nobody can settle, and a
   * rollover without a final year never ends, so both are refused here rather
   * than stored half-written and discovered on draft night.
   */
  private pickProtection(
    asset: TradeAssetDto,
    pickSeasonStartYear: number,
  ): {
    protectedTopN: number | null;
    protectionOutcome: PickProtectionOutcome | null;
    protectionFinalYear: number | null;
    protectionNote: string | null;
  } {
    const topN = asset.protectedTopN ?? null;
    const note = asset.protectionNote?.trim() || null;

    if (topN === null) {
      if (asset.protectionOutcome || asset.protectionFinalYear) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'An unprotected pick cannot carry protection terms. Set a protection first, or clear them.',
        );
      }
      return {
        protectedTopN: null,
        protectionOutcome: null,
        protectionFinalYear: null,
        protectionNote: note,
      };
    }

    if (!asset.protectionOutcome) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'A protected pick needs to say what happens if the protection holds.',
      );
    }

    let finalYear = asset.protectionFinalYear ?? null;
    if (asset.protectionOutcome === PickProtectionOutcome.rollover) {
      if (finalYear === null) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'A pick that rolls over has to name the year it finally conveys unprotected.',
        );
      }
      if (finalYear <= pickSeasonStartYear) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'The final year of a rollover has to be after the draft the pick is in.',
        );
      }
    } else {
      // Only a rollover has a final year; a conversion or an extinguished
      // obligation settles in the year it was owed.
      finalYear = null;
    }

    return {
      protectedTopN: topN,
      protectionOutcome: asset.protectionOutcome,
      protectionFinalYear: finalYear,
      protectionNote: note,
    };
  }

  private async buildSides(
    leagueId: number,
    teams: { id: number; name: string; abbr: string }[],
    assets: {
      fromTeamId: number;
      toTeamId: number;
      salary: number;
      kind: TradeAssetKind;
      leaguePlayerId?: number | null;
      playerName?: string | null;
      tradeAcquiredAt?: Date | null;
      slotType?: RosterSlotType | null;
      tradeExceptionId?: number | null;
    }[],
    league: Awaited<ReturnType<TradeService['leagueState']>>,
  ): Promise<TradeSide[]> {
    const sides: TradeSide[] = [];

    // Article 7 — an exception a team keeps is one it is using to absorb
    // salary; one going to another team is being traded away (Rule 7.5) and
    // leaves no room behind. Only the first kind reaches the rules.
    const usedExceptionIds = assets
      .filter(
        (asset) =>
          asset.kind === TradeAssetKind.tradeException &&
          asset.tradeExceptionId &&
          asset.fromTeamId === asset.toTeamId,
      )
      .map((asset) => asset.tradeExceptionId as number);

    const exceptionRows =
      usedExceptionIds.length === 0
        ? []
        : await this.prisma.tradeException.findMany({
            where: { id: { in: usedExceptionIds }, leagueId, isActive: true },
            select: {
              id: true,
              teamId: true,
              label: true,
              remaining: true,
            },
          });

    // One query for the whole trade: a hard cap is read for every side, and
    // three teams would otherwise be three round trips.
    const hardCaps = await this.hardCap.forLeague(
      leagueId,
      league.seasonStartYear,
      league.cap,
    );

    for (const team of teams) {
      const [years, dead, holds, roster, twoWay] = await Promise.all([
        this.prisma.contractYear.findMany({
          where: {
            seasonStartYear: league.seasonStartYear,
            contract: { leagueId, teamId: team.id, isActive: true },
          },
          select: { capHit: true },
        }),
        this.prisma.deadMoney.aggregate({
          where: {
            leagueId,
            teamId: team.id,
            seasonStartYear: league.seasonStartYear,
          },
          _sum: { amount: true },
        }),
        this.prisma.capHold.aggregate({
          where: {
            leagueId,
            teamId: team.id,
            seasonStartYear: league.seasonStartYear,
          },
          _sum: { amount: true },
        }),
        this.prisma.leaguePlayer.count({
          where: {
            leagueId,
            teamId: team.id,
            status: LeaguePlayerStatus.rostered,
            slotType: RosterSlotType.standard,
          },
        }),
        this.prisma.leaguePlayer.count({
          where: {
            leagueId,
            teamId: team.id,
            status: LeaguePlayerStatus.rostered,
            slotType: RosterSlotType.twoWay,
          },
        }),
      ]);

      const out = assets.filter((a) => a.fromTeamId === team.id);
      const incoming = assets.filter((a) => a.toTeamId === team.id);

      const asPlayers = (rows: typeof assets) =>
        rows
          .filter((a) => a.kind === TradeAssetKind.player)
          .map((a) => ({
            leaguePlayerId: a.leaguePlayerId ?? 0,
            name: a.playerName ?? 'Player',
            salary: a.salary,
            tradeAcquiredAt: a.tradeAcquiredAt ?? null,
            isTwoWay: a.slotType === RosterSlotType.twoWay,
          }));

      sides.push({
        teamId: team.id,
        teamName: team.name,
        teamAbbr: team.abbr,
        shortName: shortTeamName(team.name),
        outgoing: out.reduce((sum, a) => sum + a.salary, 0),
        incoming: incoming.reduce((sum, a) => sum + a.salary, 0),
        outgoingPlayers: asPlayers(out),
        incomingPlayers: asPlayers(incoming),
        assetsOut: out.length,
        assetsIn: incoming.length,
        rosterCount: roster,
        maxRosterSize: league.maxRosterSize,
        twoWayCount: twoWay,
        maxTwoWay: league.maxTwoWay,
        committed:
          years.reduce((sum, year) => sum + year.capHit, 0) +
          (dead._sum.amount ?? 0) +
          (holds._sum.amount ?? 0),
        // Article 8 needs a tax-season history that does not exist yet, so no
        // team is a Repeat Taxpayer until that is built. Recorded in
        // 11-cba-spec.md rather than guessed at.
        isRepeatTaxpayer: false,
        hardCap: hardCaps.get(team.id) ?? null,
        exceptions: exceptionRows
          .filter((row) => row.teamId === team.id)
          .map((row) => ({
            id: row.id,
            label: row.label,
            remaining: row.remaining,
          })),
      });
    }

    return sides;
  }

  private async leagueState(leagueId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { season: true, settings: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const seasonStartYear =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();

    const deadline = await this.prisma.leagueCalendarEvent.findFirst({
      where: {
        leagueId,
        season: league.season,
        phase: CalendarPhase.trades,
      },
      select: { title: true, startDate: true, endDate: true },
      orderBy: { startDate: 'asc' },
    });

    const cap = await this.cap.forLeague(leagueId, seasonStartYear);

    return {
      seasonStartYear,
      cap,
      salaryCap: cap.salaryCap,
      maxRosterSize: league.settings?.maxRosterSize ?? 15,
      maxTwoWay: league.settings?.maxTwoWay ?? 3,
      // Rule 4.8 — the reserve is counted against the league's own minimum.
      rosterMinimum: league.settings?.minRosterSize ?? 0,
      rookieMinimum: await this.hardCap.rookieMinimum(cap),
      salaryMatching: league.settings?.salaryMatching ?? false,
      apronRules: league.settings?.apronRules ?? false,
      allowTradeExceptions: league.settings?.allowTradeExceptions ?? false,
      // Rule 7.5 — whether an exception may itself change hands, which is a
      // separate permission from being allowed to use one.
      allowTradingTradeExceptions:
        league.settings?.allowTradingTradeExceptions ?? false,
      commissionerTradeApproval:
        league.settings?.commissionerTradeApproval ?? false,
      // No trade date on the calendar means no deadline to be past.
      deadlinePassed: deadline
        ? (deadline.endDate ?? deadline.startDate) < new Date()
        : false,
      deadlineLabel: deadline?.title ?? null,
    };
  }

  /** Returns which of the trade's teams the proposer holds, if any. */
  private async assertMayPropose(
    leagueId: number,
    teamIds: number[],
    userId: number,
  ) {
    const [holder, membership] = await Promise.all([
      this.prisma.teamMember.findFirst({
        where: { leagueId, userId, teamId: { in: teamIds } },
        select: { teamId: true },
      }),
      this.prisma.leagueMember.findUnique({
        where: { userId_leagueId: { userId, leagueId } },
        select: { role: true },
      }),
    ]);

    const manages =
      membership?.role === LeagueRole.commissioner ||
      membership?.role === LeagueRole.coCommissioner;

    if (!holder && !manages) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'You can only propose a trade involving a team you hold.',
      );
    }

    return holder?.teamId ?? null;
  }

  private async assertMayManage(
    leagueId: number,
    teamId: number,
    userId: number,
  ) {
    const [holder, membership] = await Promise.all([
      this.prisma.teamMember.findFirst({
        where: { teamId, userId, leagueId },
        select: { id: true },
      }),
      this.prisma.leagueMember.findUnique({
        where: { userId_leagueId: { userId, leagueId } },
        select: { role: true },
      }),
    ]);

    const manages =
      membership?.role === LeagueRole.commissioner ||
      membership?.role === LeagueRole.coCommissioner;

    if (!holder && !manages) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'Only that team or a commissioner can answer for it.',
      );
    }
  }

  private toTrade(row: TradeRow) {
    const checks = (row.checks as unknown as TradeCheck[]) ?? [];

    // The financial impact per team, which V5 asks the Pending Trades detail
    // to show for both sides.
    const impact = row.teams.map((side) => {
      const out = row.assets.filter((a) => a.fromTeamId === side.teamId);
      const incoming = row.assets.filter((a) => a.toTeamId === side.teamId);
      const outgoing = out.reduce((sum, a) => sum + a.salary, 0);
      const taken = incoming.reduce((sum, a) => sum + a.salary, 0);

      return {
        teamId: side.teamId,
        team: side.team,
        response: side.response,
        respondedAt: side.respondedAt,
        respondedBy: side.respondedBy,
        outgoing,
        incoming: taken,
        net: taken - outgoing,
        playersOut: out.filter((a) => a.kind === TradeAssetKind.player).length,
        playersIn: incoming.filter((a) => a.kind === TradeAssetKind.player)
          .length,
      };
    });

    return {
      id: row.id,
      status: row.status,
      requiresApproval: row.requiresApproval,
      message: row.message,
      rejectedReason: row.rejectedReason,
      proposedBy: row.proposedBy,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      processedAt: row.processedAt,
      createdAt: row.createdAt,
      checks,
      isLegal: tradeIsLegal(checks),
      teams: impact,
      assets: row.assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        fromTeamId: asset.fromTeamId,
        toTeamId: asset.toTeamId,
        salary: asset.salary,
        player: asset.leaguePlayer
          ? {
              leaguePlayerId: asset.leaguePlayer.id,
              id: asset.leaguePlayer.player.id,
              name: asset.leaguePlayer.player.name,
              position: asset.leaguePlayer.player.position,
            }
          : null,
        exception: asset.tradeException,
        pick: asset.draftPick
          ? {
              id: asset.draftPick.id,
              seasonStartYear: asset.draftPick.seasonStartYear,
              round: asset.draftPick.round,
              label: pickLabel(
                asset.draftPick.seasonStartYear,
                asset.draftPick.round,
              ),
              protectedTopN: asset.draftPick.protectedTopN,
              originalTeam: asset.draftPick.originalTeam,
              // The terms this trade set, which may differ from whatever the
              // pick carries now.
              protection: asset.protectedTopN
                ? {
                    topN: asset.protectedTopN,
                    outcome: asset.protectionOutcome,
                    finalYear: asset.protectionFinalYear,
                    label: protectionLabel(
                      asset.protectedTopN,
                      asset.protectionOutcome,
                      asset.protectionFinalYear,
                    ),
                  }
                : null,
              protectionNote: asset.protectionNote,
            }
          : null,
      })),
    };
  }

  /**
   * Everything Rule 12.11 needs to judge a pick, read once per proposal.
   *
   * Every pick in the league, not just the ones in the deal: the back-to-back
   * rule (Rule 12.2) asks whether the original team has already given away a
   * first-rounder in the draft either side of this one.
   */
  private async pickTradingState(leagueId: number, seasonStartYear: number) {
    const [settings, picks] = await Promise.all([
      this.prisma.leagueSettings.findUnique({
        where: { leagueId },
        select: {
          allowDraftPickTrading: true,
          pickTradingWindowDrafts: true,
        },
      }),
      this.prisma.draftPick.findMany({
        where: { leagueId },
        select: {
          id: true,
          seasonStartYear: true,
          round: true,
          originalTeamId: true,
          currentTeamId: true,
          protectedTopN: true,
          protectionOutcome: true,
          protectionFinalYear: true,
          frozenInSeason: true,
          usedAt: true,
        },
      }),
    ]);

    return {
      seasonStartYear,
      picks,
      allowDraftPickTrading: settings?.allowDraftPickTrading ?? true,
      windowDrafts: settings?.pickTradingWindowDrafts ?? DEFAULT_PICK_WINDOW,
    };
  }
}
