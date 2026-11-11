import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ContractOptionType,
  GuaranteeType,
  LeaguePlayerStatus,
  LeagueRole,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import { CapService } from '../cap/cap.service';

/**
 * Rules 10.14 and 10.15 — waiving a player, and what it leaves behind.
 *
 * What this does **not** do is the waiver period itself (Rule 10.13): a waived
 * player is claimed by priority, and waiver priority is a commissioner setting
 * (Rule 2.8) that does not exist yet. Inventing an order would be inventing a
 * rule, so the player goes to `waived` and stays there until free agency or a
 * commissioner moves him. Rule 9.5's bird-year reset belongs to that same
 * step — it fires when he *clears waivers unclaimed*, not when he is waived —
 * so his bird years are left alone here.
 */

/** One season of money the releasing team still owes. */
type DeadSeason = { seasonStartYear: number; amount: number };

/**
 * What a contract year still owes if the player is let go today.
 *
 * An **option year is skipped**. The obligation depends on a decision nobody
 * has made yet — Rule 11.6 puts option deadlines on the league calendar — so
 * charging a team for a fifth year it never picked up would be inventing a
 * debt. Everything else is owed according to its guarantee, which is the field
 * that exists for exactly this question.
 */
function owedFor(year: {
  salary: number;
  guaranteeType: GuaranteeType;
  guaranteedAmount: number | null;
  optionType: ContractOptionType | null;
}): number {
  if (year.optionType !== null) return 0;

  if (year.guaranteeType === GuaranteeType.none) return 0;
  if (year.guaranteeType === GuaranteeType.partial) {
    return year.guaranteedAmount ?? 0;
  }
  return year.salary;
}

@Injectable()
export class WaiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capService: CapService,
  ) {}

  /**
   * What waiving him would cost, without doing it.
   *
   * The screen asks before it shows a confirmation, so the owner sees the
   * figure and the stretch alternative before committing to either. It is the
   * same arithmetic the write uses, called from one place, so the preview
   * cannot promise a number the write then changes.
   */
  async preview(
    leagueId: number,
    teamId: number,
    leaguePlayerId: number,
    userId: number,
  ) {
    const plan = await this.plan(leagueId, teamId, leaguePlayerId, userId);

    return {
      playerName: plan.playerName,
      seasonStartYear: plan.seasonStartYear,
      /** Seasons still owed, and what each one costs, if taken as it stands. */
      straight: plan.straight,
      straightTotal: plan.total,
      /** Rule 10.15 — null when the stretch is not available or not allowed. */
      stretch: plan.stretch,
      stretchYears: plan.stretch?.length ?? 0,
      stretchBlockedReason: plan.stretchBlockedReason,
      stretchLimit: plan.stretchLimit,
      stretchAlreadyUsed: plan.stretchAlreadyUsed,
    };
  }

  /**
   * Waives him, and writes the dead money.
   *
   * Rule 4.4 — waiving is always allowed, even for a hard-capped team: it only
   * ever lowers what a team is paying this season, or leaves it the same.
   * Nothing here checks a ceiling.
   */
  async waive(
    leagueId: number,
    teamId: number,
    leaguePlayerId: number,
    stretch: boolean,
    userId: number,
  ) {
    const plan = await this.plan(leagueId, teamId, leaguePlayerId, userId);

    if (stretch) {
      if (!plan.stretch) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          plan.stretchBlockedReason ?? 'This contract cannot be stretched.',
        );
      }
    }

    const rows = stretch ? plan.stretch! : plan.straight;
    const owedSeasons = rows.filter((row) => row.amount > 0).length;
    const owedTotal = rows.reduce((sum, row) => sum + row.amount, 0);

    await this.prisma.$transaction(async (tx) => {
      // Rule 10.14 — the money becomes dead cap for the releasing team. One
      // row per season, because that is what the cap sheet reads and a single
      // total would have to be divided again by whoever shows it.
      for (const row of rows) {
        if (row.amount <= 0) continue;

        await tx.deadMoney.upsert({
          where: {
            leagueId_teamId_playerId_seasonStartYear: {
              leagueId,
              teamId,
              playerId: plan.playerId,
              seasonStartYear: row.seasonStartYear,
            },
          },
          create: {
            leagueId,
            teamId,
            playerId: plan.playerId,
            seasonStartYear: row.seasonStartYear,
            amount: row.amount,
            isStretched: stretch,
          },
          // A player waived, re-signed and waived again in the same season
          // would otherwise collide on the unique key.
          update: { amount: row.amount, isStretched: stretch },
        });
      }

      if (plan.contractId !== null) {
        await tx.contract.update({
          where: { id: plan.contractId },
          data: { isActive: false },
        });
      }

      // The roster spot is given up, so the team is cleared. The dead money
      // keeps pointing at the team that waived him, which is why `DeadMoney`
      // is keyed on team and player directly rather than through this row.
      await tx.leaguePlayer.update({
        where: { id: leaguePlayerId },
        data: { teamId: null, status: LeaguePlayerStatus.waived },
      });

      // The release itself, written whether or not it cost anything. A player
      // with nothing guaranteed produces no `DeadMoney` row at all, and
      // without this the move would leave no trace in the transaction feed.
      await tx.waiver.create({
        data: {
          leagueId,
          teamId,
          playerId: plan.playerId,
          seasonStartYear: plan.seasonStartYear,
          deadMoneyTotal: owedTotal,
          isStretched: stretch,
          seasonsOwed: owedSeasons,
        },
      });
    });

    return {
      playerName: plan.playerName,
      stretched: stretch,
      seasons: rows.filter((row) => row.amount > 0),
      total: owedTotal,
    };
  }

  /**
   * The arithmetic both the preview and the write run.
   *
   * Kept private and shared so there is one answer to "what does this cost",
   * rather than two that can drift apart.
   */
  private async plan(
    leagueId: number,
    teamId: number,
    leaguePlayerId: number,
    userId: number,
  ) {
    await this.assertMayManage(leagueId, teamId, userId);

    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { season: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const seasonStartYear =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();

    const row = await this.prisma.leaguePlayer.findFirst({
      where: { id: leaguePlayerId, leagueId, teamId },
      select: {
        id: true,
        playerId: true,
        status: true,
        player: { select: { name: true } },
        contracts: {
          where: { isActive: true },
          select: {
            id: true,
            years: {
              where: { seasonStartYear: { gte: seasonStartYear } },
              select: {
                seasonStartYear: true,
                salary: true,
                guaranteeType: true,
                guaranteedAmount: true,
                optionType: true,
              },
              orderBy: { seasonStartYear: 'asc' },
            },
          },
          take: 1,
        },
      },
    });
    if (!row) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'That player is not on this team.',
      );
    }
    if (row.status !== LeaguePlayerStatus.rostered) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${row.player.name} is not on the active roster.`,
      );
    }

    const contract = row.contracts[0] ?? null;

    const straight: DeadSeason[] = (contract?.years ?? []).map((year) => ({
      seasonStartYear: year.seasonStartYear,
      amount: owedFor(year),
    }));

    const total = straight.reduce((sum, season) => sum + season.amount, 0);

    const { stretch, stretchBlockedReason, stretchLimit, stretchAlreadyUsed } =
      await this.stretchPlan({
        leagueId,
        teamId,
        seasonStartYear,
        total,
        remainingYears: straight.length,
      });

    return {
      playerId: row.playerId,
      playerName: row.player.name,
      contractId: contract?.id ?? null,
      seasonStartYear,
      straight,
      total,
      stretch,
      stretchBlockedReason,
      stretchLimit,
      stretchAlreadyUsed,
    };
  }

  /**
   * Rule 10.15 — the same money over twice the remaining years, plus one.
   *
   * The ceiling is on the **team**, not on the contract: total stretched
   * salary may not exceed 15% of the cap, and what is already stretched counts
   * towards it. So the limit is checked against the sum, and the reason says
   * which figure blocked it rather than just refusing.
   */
  private async stretchPlan(input: {
    leagueId: number;
    teamId: number;
    seasonStartYear: number;
    total: number;
    remainingYears: number;
  }) {
    const cap = await this.capService.forLeague(
      input.leagueId,
      input.seasonStartYear,
    );

    const existing = await this.prisma.deadMoney.aggregate({
      where: {
        leagueId: input.leagueId,
        teamId: input.teamId,
        isStretched: true,
      },
      _sum: { amount: true },
    });
    const stretchAlreadyUsed = existing._sum.amount ?? 0;
    const stretchLimit = cap.stretchLimit;

    if (input.total <= 0 || input.remainingYears === 0) {
      return {
        stretch: null,
        stretchBlockedReason:
          'There is no guaranteed money left to stretch.' as string | null,
        stretchLimit,
        stretchAlreadyUsed,
      };
    }

    if (stretchLimit > 0 && stretchAlreadyUsed + input.total > stretchLimit) {
      return {
        stretch: null,
        stretchBlockedReason:
          `Rule 10.15 caps stretched salary at ${stretchLimit.toLocaleString('en-US')}. ` +
          `This team already has ${stretchAlreadyUsed.toLocaleString('en-US')} stretched, ` +
          `and stretching this contract would add ${input.total.toLocaleString('en-US')}.`,
        stretchLimit,
        stretchAlreadyUsed,
      };
    }

    const years = input.remainingYears * 2 + 1;

    // The last season carries the rounding, so the parts add back to exactly
    // what was owed. Spreading the remainder evenly would leave a total a
    // dollar or two away from the contract, and a cap sheet that does not
    // reconcile is worse than an uneven final year.
    const perYear = Math.floor(input.total / years);
    const stretch: DeadSeason[] = Array.from({ length: years }, (_, index) => ({
      seasonStartYear: input.seasonStartYear + index,
      amount:
        index === years - 1 ? input.total - perYear * (years - 1) : perYear,
    }));

    return {
      stretch,
      stretchBlockedReason: null as string | null,
      stretchLimit,
      stretchAlreadyUsed,
    };
  }

  /**
   * Its owner, its co-owner, or a commissioner.
   *
   * `@LeagueAuth()` proves membership of the league, which every manager has,
   * so it cannot answer this on its own — the same reason `setSlot` asks it
   * here rather than in a guard.
   */
  private async assertMayManage(
    leagueId: number,
    teamId: number,
    userId: number,
  ) {
    const [membership, teamMembership] = await Promise.all([
      this.prisma.leagueMember.findUnique({
        where: { userId_leagueId: { userId, leagueId } },
        select: { role: true },
      }),
      this.prisma.teamMember.findFirst({
        where: { leagueId, teamId, userId },
        select: { id: true },
      }),
    ]);

    const isManager =
      membership?.role === LeagueRole.commissioner ||
      membership?.role === LeagueRole.coCommissioner;

    if (!isManager && !teamMembership) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'Only this team or a commissioner can waive its players.',
      );
    }
  }
}
