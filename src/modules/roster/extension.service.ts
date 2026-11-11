import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ContractOptionType,
  ContractSource,
  ContractType,
  GuaranteeType,
  LeaguePlayerStatus,
  LeagueRole,
  SignedVia,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import { CapService } from '../cap/cap.service';
import { birdRightsOf } from '../free-agency/free-agency.rules';
import {
  extensionLimits,
  extensionProblems,
  type ExtensionKind,
  type ExtensionYearInput,
} from './extension.rules';

/**
 * Rules 10.7 and 10.8 — extending a player already under contract.
 *
 * The owner names the first-year salary and the engine refuses anything the
 * rule book does not allow. It does **not** work the salary out for them:
 * Rules 10.7 and 10.8 say the starting salary comes from "the owner's ranking
 * input", and Appendix B item 7 records those rules as still to be defined.
 * The ceiling is defined, so the ceiling is enforced; the ranking is the
 * client's to specify.
 *
 * A signed extension is a **second contract** rather than extra years bolted
 * onto the current one. The current deal still has to be payable exactly as
 * agreed until it runs out, and a cap sheet that reads one contract for two
 * different agreements cannot show that honestly.
 */

@Injectable()
export class ExtensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capService: CapService,
  ) {}

  /** The limits the offer screen draws, with the reason it cannot be offered. */
  async limits(
    leagueId: number,
    teamId: number,
    leaguePlayerId: number,
    userId: number,
  ) {
    const state = await this.load(leagueId, teamId, leaguePlayerId, userId);

    if (!state.ok) {
      return {
        eligible: false as const,
        blockedReason: state.blockedReason,
        playerName: state.playerName,
      };
    }

    return {
      eligible: true as const,
      blockedReason: null,
      playerName: state.playerName,
      /** The deal being extended, so the screen can show what it follows. */
      current: {
        contractId: state.contract.id,
        startSeasonStartYear: state.contract.startSeasonStartYear,
        endSeasonStartYear: state.contract.endSeasonStartYear,
        finalSeasonSalary: state.priorSalary,
      },
      limits: state.limits,
    };
  }

  async offer(
    leagueId: number,
    teamId: number,
    leaguePlayerId: number,
    years: ExtensionYearInput[],
    userId: number,
  ) {
    const state = await this.load(leagueId, teamId, leaguePlayerId, userId);

    if (!state.ok) {
      throw new AppError(HttpStatus.BAD_REQUEST, state.blockedReason);
    }

    const problems = extensionProblems(years, state.limits);
    if (problems.length > 0) {
      // The first one, because the screen lists them all from the preview and
      // a refusal only has to name why it stopped.
      throw new AppError(HttpStatus.BAD_REQUEST, problems[0]);
    }

    const sorted = [...years].sort(
      (a, b) => a.seasonStartYear - b.seasonStartYear,
    );

    const contract = await this.prisma.contract.create({
      data: {
        leagueId,
        leaguePlayerId,
        teamId,
        contractType:
          state.limits.kind === 'rookieScale'
            ? ContractType.standard
            : ContractType.standard,
        // An extension is signed with his own team over the cap on his bird
        // rights, not out of cap space — Rule 9.1 is what makes it possible.
        signedVia: SignedVia.capSpace,
        source: ContractSource.signing,
        signedSeasonStartYear: state.seasonStartYear,
        startSeasonStartYear: sorted[0].seasonStartYear,
        endSeasonStartYear: sorted[sorted.length - 1].seasonStartYear,
        isActive: true,
        years: {
          create: sorted.map((year) => ({
            seasonStartYear: year.seasonStartYear,
            salary: year.salary,
            // Nothing here is a two-way deal, so the cap hit is the salary.
            capHit: year.salary,
            optionType:
              year.optionType === 'player'
                ? ContractOptionType.player
                : year.optionType === 'team'
                  ? ContractOptionType.team
                  : null,
            // Rule 11.12's principle, generalised: an option year is the one
            // year that is not guaranteed, because the option is the whole
            // point of it.
            guaranteeType:
              year.optionType === null
                ? GuaranteeType.full
                : GuaranteeType.none,
          })),
        },
      },
      select: {
        id: true,
        startSeasonStartYear: true,
        endSeasonStartYear: true,
        years: {
          select: { seasonStartYear: true, salary: true, optionType: true },
          orderBy: { seasonStartYear: 'asc' },
        },
      },
    });

    return {
      playerName: state.playerName,
      contract,
      total: sorted.reduce((sum, year) => sum + year.salary, 0),
    };
  }

  /**
   * Everything both routes need, and the one reason it cannot go ahead.
   *
   * A refusal is returned rather than thrown on the read path: the screen has
   * to be able to say *why* a player cannot be extended, and an error with a
   * message is a worse way to carry that than a field.
   */
  private async load(
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
        birdYears: true,
        status: true,
        supermaxEligible: true,
        rookieMax30Eligible: true,
        player: {
          select: { name: true, yearsOfService: true, draftYear: true },
        },
        contracts: {
          where: { isActive: true },
          select: {
            id: true,
            contractType: true,
            startSeasonStartYear: true,
            endSeasonStartYear: true,
            years: {
              select: { seasonStartYear: true, salary: true },
              orderBy: { seasonStartYear: 'asc' },
            },
          },
          orderBy: { endSeasonStartYear: 'desc' },
        },
      },
    });
    if (!row) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'That player is not on this team.',
      );
    }

    const playerName = row.player.name;
    const blocked = (reason: string) =>
      ({ ok: false, blockedReason: reason, playerName }) as const;

    if (row.status !== LeaguePlayerStatus.rostered) {
      return blocked(`${playerName} is not on the active roster.`);
    }

    // An extension already signed is itself an active contract, so the player
    // now has two and cannot have a third stacked on top.
    if (row.contracts.length > 1) {
      return blocked(
        `${playerName} already has an extension signed on top of his current deal.`,
      );
    }

    const contract = row.contracts[0];
    if (!contract) {
      return blocked(
        `${playerName} has no contract to extend. A free agent is signed from the Free Agency screen.`,
      );
    }

    if (contract.endSeasonStartYear < seasonStartYear) {
      return blocked(`${playerName}'s contract has already run out.`);
    }

    const kind: ExtensionKind =
      contract.contractType === ContractType.rookieScale
        ? 'rookieScale'
        : 'veteran';

    // Rule 10.8 — a rookie-scale extension is available after his third
    // season and before his fourth. Counted from the contract's own start,
    // because that is the season the scale deal began.
    if (kind === 'rookieScale') {
      const seasonsPlayed = seasonStartYear - contract.startSeasonStartYear;
      if (seasonsPlayed < 3) {
        return blocked(
          `Rule 10.8 opens a rookie-scale extension after his third season. ${playerName} has completed ${seasonsPlayed}.`,
        );
      }
      if (seasonsPlayed > 3) {
        return blocked(
          `Rule 10.8 closes the rookie-scale extension window before his fourth season, which has passed.`,
        );
      }
    }

    const finalYear = contract.years.find(
      (year) => year.seasonStartYear === contract.endSeasonStartYear,
    );
    // Rules 10.7 and 10.3 both measure from what he is paid at the end of the
    // deal, not from what he is paid today.
    const priorSalary = finalYear?.salary ?? 0;
    if (priorSalary <= 0) {
      return blocked(
        `${playerName}'s contract has no salary in its final season to extend from.`,
      );
    }

    const cap = await this.capService.forLeague(leagueId, seasonStartYear);
    if (cap.salaryCap <= 0) {
      return blocked(
        'This league has not set a salary cap, so no extension can be priced.',
      );
    }

    return {
      ok: true,
      playerName,
      seasonStartYear,
      contract,
      priorSalary,
      limits: extensionLimits({
        kind,
        cap,
        bird: birdRightsOf(row.birdYears),
        priorSalary,
        yearsOfService: row.player.yearsOfService,
        supermaxEligible: row.supermaxEligible,
        rookieMax30Eligible: row.rookieMax30Eligible,
        endSeasonStartYear: contract.endSeasonStartYear,
      }),
    } as const;
  }

  /** Its owner, its co-owner, or a commissioner — as `setSlot` and `waive`. */
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
        'Only this team or a commissioner can extend its players.',
      );
    }
  }
}
