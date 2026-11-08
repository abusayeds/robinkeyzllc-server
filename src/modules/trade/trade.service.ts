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
import { HardCapTrigger } from '@prisma/client';
import { ProposeTradeDto } from './dto/propose-trade.dto';
import {
  checkTrade,
  exceptionFor,
  TradeCheck,
  TradeSide,
  tradeIsLegal,
} from './trade.rules';

/** How long an exception earned in a trade lasts. */
const EXCEPTION_DAYS = 365;

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
      leaguePlayer: {
        select: {
          id: true,
          player: { select: { id: true, name: true, position: true } },
        },
      },
      tradeException: { select: { id: true, label: true, remaining: true } },
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
    return this.toTrade(trade);
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
      select: { id: true, name: true },
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
    const assets = await this.resolveAssets(leagueId, payload);
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
              salary: asset.salary,
            })),
          },
        },
        select: { id: true },
      });
      return created;
    });

    return this.findOne(leagueId, trade.id);
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

    await this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        status: TradeStatus.rejected,
        approvedById: userId,
        approvedAt: new Date(),
        rejectedReason: reason?.trim() || null,
      },
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
          },
        },
        teams: { select: { teamId: true, team: { select: { name: true } } } },
      },
    });

    const league = await this.leagueState(leagueId);
    const expiresAt = new Date(
      Date.now() + EXCEPTION_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      for (const asset of trade.assets) {
        if (asset.kind === TradeAssetKind.player && asset.leaguePlayerId) {
          await tx.leaguePlayer.update({
            where: { id: asset.leaguePlayerId },
            data: { teamId: asset.toTeamId },
          });
          await tx.contract.updateMany({
            where: { leaguePlayerId: asset.leaguePlayerId, isActive: true },
            data: { teamId: asset.toTeamId },
          });
        }

        if (
          asset.kind === TradeAssetKind.tradeException &&
          asset.tradeExceptionId
        ) {
          // An exception does not split when it moves; the whole thing
          // changes hands.
          await tx.tradeException.update({
            where: { id: asset.tradeExceptionId },
            data: { teamId: asset.toTeamId },
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
          teamId: row.teamId,
          teamName: row.team.name,
          outgoing: out.reduce((sum, a) => sum + a.salary, 0),
          incoming,
          largestOutgoing:
            outgoingSalaries.length > 0 ? Math.max(...outgoingSalaries) : 0,
          outgoingPlayerCount: outgoingSalaries.length,
          playersOut: 0,
          playersIn: 0,
          rosterCount: 0,
          maxRosterSize: 0,
          committed: 0,
          isRepeatTaxpayer: false,
          hardCap: null,
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

      await tx.trade.update({
        where: { id: tradeId },
        data: { status: TradeStatus.processed, processedAt: new Date() },
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
        expiresAt: true,
        team: { select: { id: true, name: true, abbr: true } },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  private async resolveAssets(leagueId: number, payload: ProposeTradeDto) {
    const seasonStartYear = (await this.leagueState(leagueId)).seasonStartYear;
    const resolved: {
      kind: TradeAssetKind;
      fromTeamId: number;
      toTeamId: number;
      leaguePlayerId: number | null;
      tradeExceptionId: number | null;
      salary: number;
    }[] = [];

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
          salary: row.contracts[0]?.years[0]?.capHit ?? 0,
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

      resolved.push({
        kind: TradeAssetKind.tradeException,
        fromTeamId: asset.fromTeamId,
        toTeamId: asset.toTeamId,
        leaguePlayerId: null,
        tradeExceptionId: exception.id,
        // An exception carries no salary into the matching sum: it is room,
        // not money owed.
        salary: 0,
      });
    }

    return resolved;
  }

  private async buildSides(
    leagueId: number,
    teams: { id: number; name: string }[],
    assets: {
      fromTeamId: number;
      toTeamId: number;
      salary: number;
      kind: TradeAssetKind;
    }[],
    league: Awaited<ReturnType<TradeService['leagueState']>>,
  ): Promise<TradeSide[]> {
    const sides: TradeSide[] = [];

    // One query for the whole trade: a hard cap is read for every side, and
    // three teams would otherwise be three round trips.
    const hardCaps = await this.hardCap.forLeague(
      leagueId,
      league.seasonStartYear,
      league.cap,
    );

    for (const team of teams) {
      const [years, dead, holds, roster] = await Promise.all([
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
      ]);

      const out = assets.filter((a) => a.fromTeamId === team.id);
      const incoming = assets.filter((a) => a.toTeamId === team.id);

      const outgoingSalaries = out
        .filter((a) => a.kind === TradeAssetKind.player)
        .map((a) => a.salary);

      sides.push({
        teamId: team.id,
        teamName: team.name,
        outgoing: out.reduce((sum, a) => sum + a.salary, 0),
        incoming: incoming.reduce((sum, a) => sum + a.salary, 0),
        largestOutgoing:
          outgoingSalaries.length > 0 ? Math.max(...outgoingSalaries) : 0,
        outgoingPlayerCount: outgoingSalaries.length,
        playersOut: out.filter((a) => a.kind === TradeAssetKind.player).length,
        playersIn: incoming.filter((a) => a.kind === TradeAssetKind.player)
          .length,
        rosterCount: roster,
        maxRosterSize: league.maxRosterSize,
        committed:
          years.reduce((sum, year) => sum + year.capHit, 0) +
          (dead._sum.amount ?? 0) +
          (holds._sum.amount ?? 0),
        // Article 8 needs a tax-season history that does not exist yet, so no
        // team is a Repeat Taxpayer until that is built. Recorded in
        // 11-cba-spec.md rather than guessed at.
        isRepeatTaxpayer: false,
        hardCap: hardCaps.get(team.id) ?? null,
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
      // Rule 4.8 — the reserve is counted against the league's own minimum.
      rosterMinimum: league.settings?.minRosterSize ?? 0,
      rookieMinimum: await this.hardCap.rookieMinimum(cap),
      salaryMatching: league.settings?.salaryMatching ?? false,
      apronRules: league.settings?.apronRules ?? false,
      allowTradeExceptions: league.settings?.allowTradeExceptions ?? false,
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
      })),
    };
  }
}
