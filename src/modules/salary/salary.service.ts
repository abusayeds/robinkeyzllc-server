import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ContractOptionType,
  ContractType,
  GuaranteeType,
  LeaguePlayerStatus,
  Prisma,
  RosterSlotType,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import { CapService } from '../cap/cap.service';
import { tierFor, toolsFor, TIER, TIER_LABEL } from '../cap/cap.tiers';
import type { EffectiveCap } from '../cap/cap.service';

// Tiers moved to the cap engine when the CBA arrived: Article 3 defines five
// of them, with names the rule book uses, and they are read by trades and
// signings as well as by this screen.
export { TIER, TIER_LABEL };

/**
 * How far ahead the payroll outlook runs when a league has said nothing.
 *
 * Rule 12.1's own number. A league that has changed its pick-trading window
 * is read from its settings instead: the client's rule is that every table
 * showing future league years shows the same number of them, so a league
 * trading picks three drafts out sees three seasons here too.
 */
const OUTLOOK_SEASONS = 7;

/**
 * Article 6 — the signing tools a payroll keeps, for one league year.
 *
 * Rule 3.4 reads a team's tier from where it lands, which on a page about a
 * future season is simply what it owes for that season. An exception already
 * spent is not deducted: that ledger is Article 9, which is not built, so
 * `available` means "this tier allows it", never "it is still unspent".
 */
function exceptionsFor(cap: EffectiveCap, committed: number) {
  const tools = toolsFor(tierFor(committed, cap), false);

  return [
    {
      key: 'nonTaxpayerMle',
      label: 'Non-Taxpayer MLE',
      amount: cap.nonTaxpayerMle,
      available: tools.canUseNonTaxpayerMle,
      why: tools.canUseNonTaxpayerMle ? null : 'No room under the 1st apron',
    },
    {
      key: 'taxpayerMle',
      label: 'Taxpayer MLE',
      amount: cap.taxpayerMle,
      available: tools.canUseTaxpayerMle,
      why: tools.canUseTaxpayerMle ? null : 'No room under the 2nd apron',
    },
    {
      key: 'biAnnual',
      label: 'Bi-annual exception',
      amount: cap.biAnnualException,
      available: tools.canUseBiAnnual,
      why: tools.canUseBiAnnual ? null : 'No room under the 1st apron',
    },
    {
      key: 'roomException',
      label: 'Room MLE',
      amount: cap.roomException,
      available: tools.canUseRoomException,
      why: tools.canUseRoomException ? null : 'Only under the cap',
    },
    {
      key: 'minimum',
      label: 'Minimum salary',
      amount: null,
      available: true,
      why: null,
    },
  ];
}

const CONTRACT_SELECT = {
  id: true,
  teamId: true,
  contractType: true,
  signedVia: true,
  startSeasonStartYear: true,
  endSeasonStartYear: true,
  rfaOnExpiry: true,
  leaguePlayer: {
    select: {
      id: true,
      playerId: true,
      status: true,
      slotType: true,
      birdYears: true,
      player: {
        select: {
          name: true,
          position: true,
          // Not in the NBA feed, so a commissioner enters it; the card shows
          // it beside bird years and both are edited from there.
          yearsOfService: true,
          yearsOfServiceEstimated: true,
        },
      },
    },
  },
  years: {
    select: {
      seasonStartYear: true,
      salary: true,
      capHit: true,
      optionType: true,
      guaranteeType: true,
      guaranteedAmount: true,
    },
    orderBy: { seasonStartYear: 'asc' as const },
  },
} satisfies Prisma.ContractSelect;

type ContractRow = Prisma.ContractGetPayload<{
  select: typeof CONTRACT_SELECT;
}>;

@Injectable()
export class SalaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capService: CapService,
  ) {}

  /**
   * Every team's committed salary for one season, against the league's own cap.
   *
   * Three separate charges make up a team's books and they are reported apart,
   * not merged: contracts, dead money for players it waived, and cap holds for
   * rights it still owns. A single payroll figure would hide which of the three
   * a team is actually in trouble with.
   */
  /**
   * A commissioner corrects one contract.
   *
   * Imports and real life disagree, so the figures have to be editable
   * without re-uploading a whole league. Only the seasons sent are touched,
   * and a two-way deal stays at a zero cap hit however it is edited — that
   * is what makes it a two-way deal rather than a cheap contract.
   */
  async editContract(
    leagueId: number,
    contractId: number,
    years: {
      seasonStartYear: number;
      salary: number;
      capHit?: number;
      optionType?: ContractOptionType | null;
      guaranteeType?: GuaranteeType;
      guaranteedAmount?: number | null;
    }[],
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, leagueId },
      select: {
        id: true,
        contractType: true,
        leaguePlayer: {
          select: { id: true, player: { select: { name: true } } },
        },
        years: { select: { seasonStartYear: true } },
      },
    });
    if (!contract) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Contract not found');
    }

    const isTwoWay = contract.contractType === ContractType.twoWay;
    const known = new Set(contract.years.map((year) => year.seasonStartYear));

    for (const year of years) {
      if (!known.has(year.seasonStartYear)) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          `This contract has no ${year.seasonStartYear}-${String((year.seasonStartYear + 1) % 100).padStart(2, '0')} season. Add the year on the import, or edit a season it has.`,
        );
      }
      if (
        year.guaranteeType === GuaranteeType.partial &&
        (year.guaranteedAmount === null || year.guaranteedAmount === undefined)
      ) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'A partially guaranteed season needs the guaranteed amount.',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const year of years) {
        await tx.contractYear.update({
          where: {
            contractId_seasonStartYear: {
              contractId,
              seasonStartYear: year.seasonStartYear,
            },
          },
          data: {
            salary: year.salary,
            capHit: isTwoWay ? 0 : (year.capHit ?? year.salary),
            ...(year.optionType !== undefined
              ? { optionType: year.optionType }
              : {}),
            ...(year.guaranteeType !== undefined
              ? { guaranteeType: year.guaranteeType }
              : {}),
            ...(year.guaranteedAmount !== undefined
              ? {
                  guaranteedAmount:
                    year.guaranteeType === GuaranteeType.partial
                      ? year.guaranteedAmount
                      : null,
                }
              : {}),
          },
        });
      }
    });

    return {
      contractId,
      playerName: contract.leaguePlayer.player.name,
      updated: years.length,
    };
  }

  /**
   * A commissioner corrects a player's bird years or his experience.
   *
   * Two different facts, edited together because the card shows them side by
   * side. Bird years belong to this league's copy of the player (Rule 9.1
   * counts seasons under contract here), so they are written to
   * `LeaguePlayer`. Years of service belongs to the player himself and is
   * shared by every league, so it is written to `Player` — and writing it by
   * hand clears the estimated flag, because somebody has now said what it is.
   */
  async editPlayerService(
    leagueId: number,
    leaguePlayerId: number,
    input: {
      birdYears?: number;
      yearsOfService?: number;
      birdRightsTeamId?: number | null;
    },
  ) {
    if (
      input.birdYears === undefined &&
      input.yearsOfService === undefined &&
      input.birdRightsTeamId === undefined
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Send bird years, years of service, the team holding his bird rights, or any combination.',
      );
    }

    const row = await this.prisma.leaguePlayer.findFirst({
      where: { id: leaguePlayerId, leagueId },
      select: { id: true, playerId: true, player: { select: { name: true } } },
    });
    if (!row) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'That player is not in this league.',
      );
    }

    // A team from another league holding rights in this one would be
    // invisible on every screen and impossible to notice.
    if (
      input.birdRightsTeamId !== undefined &&
      input.birdRightsTeamId !== null
    ) {
      const team = await this.prisma.team.findFirst({
        where: { id: input.birdRightsTeamId, leagueId },
        select: { id: true },
      });
      if (!team) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'That team is not in this league.',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.birdYears !== undefined) {
        await tx.leaguePlayer.update({
          where: { id: row.id },
          data: { birdYears: input.birdYears },
        });
      }
      if (input.birdRightsTeamId !== undefined) {
        await tx.leaguePlayer.update({
          where: { id: row.id },
          data: { birdRightsTeamId: input.birdRightsTeamId },
        });
      }
      if (input.yearsOfService !== undefined) {
        await tx.player.update({
          where: { id: row.playerId },
          data: {
            yearsOfService: input.yearsOfService,
            yearsOfServiceEstimated: false,
          },
        });
      }
    });

    return {
      leaguePlayerId: row.id,
      playerName: row.player.name,
      birdYears: input.birdYears ?? null,
      yearsOfService: input.yearsOfService ?? null,
      birdRightsTeamId: input.birdRightsTeamId ?? null,
    };
  }

  async overview(leagueId: number, season?: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: {
        season: true,
        settings: {
          select: {
            salaryCap: true,
            minPlayerSalary: true,
            hardCapEnabled: true,
            hardCapThreshold: true,
          },
        },
      },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const seasonStartYear =
      season ?? parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();

    // Article 2 — the thresholds are the Super Admin's entered figures for
    // this league year, or the league's own if it uses custom numbers. They
    // are never worked out from a multiplier in code.
    const effective = await this.capService.forLeague(
      leagueId,
      seasonStartYear,
    );
    const salaryCap = effective.salaryCap;
    const cap = {
      salaryCap,
      source: effective.source,
      minPlayerSalary: league.settings?.minPlayerSalary ?? 0,
      hardCapEnabled: league.settings?.hardCapEnabled ?? false,
      hardCapThreshold: league.settings?.hardCapThreshold ?? null,
      salaryFloor: effective.salaryFloor,
      luxuryTax: effective.luxuryTax,
      firstApron: effective.firstApron,
      secondApron: effective.secondApron,
      averagePlayerSalary: effective.averagePlayerSalary,
      // Rule 10.2 — the maximum depends on a player's years of service, so
      // the three tiers are all reported rather than one figure.
      maxSalary0to6: effective.maxSalary0to6,
      maxSalary7to9: effective.maxSalary7to9,
      maxSalary10Plus: effective.maxSalary10Plus,
      nonTaxpayerMle: effective.nonTaxpayerMle,
      taxpayerMle: effective.taxpayerMle,
      roomException: effective.roomException,
      biAnnualException: effective.biAnnualException,
    };

    const [teams, contracts, deadMoney, capHolds] = await Promise.all([
      this.prisma.team.findMany({
        where: { leagueId },
        select: { id: true, name: true, abbr: true, color: true, logo: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.contract.findMany({
        where: {
          leagueId,
          isActive: true,
          years: { some: { seasonStartYear } },
        },
        select: CONTRACT_SELECT,
      }),
      this.prisma.deadMoney.findMany({
        where: { leagueId, seasonStartYear },
        select: {
          id: true,
          teamId: true,
          amount: true,
          isStretched: true,
          player: { select: { id: true, name: true } },
        },
      }),
      this.prisma.capHold.findMany({
        where: { leagueId, seasonStartYear },
        select: {
          id: true,
          teamId: true,
          amount: true,
          isQualifyingOffer: true,
          leaguePlayer: {
            select: { id: true, player: { select: { id: true, name: true } } },
          },
        },
      }),
    ]);

    const contractsByTeam = this.groupBy(contracts, (row) => row.teamId);
    const deadByTeam = this.groupBy(deadMoney, (row) => row.teamId);
    const holdsByTeam = this.groupBy(capHolds, (row) => row.teamId);

    return {
      seasonStartYear,
      cap,
      teams: teams.map((team) => {
        const teamContracts = (contractsByTeam.get(team.id) ?? []).map((row) =>
          this.toContract(row, seasonStartYear),
        );
        const teamDead = deadByTeam.get(team.id) ?? [];
        const teamHolds = holdsByTeam.get(team.id) ?? [];

        const payroll = teamContracts.reduce(
          (total, row) => total + row.capHit,
          0,
        );
        const deadMoneyTotal = teamDead.reduce(
          (total, row) => total + row.amount,
          0,
        );
        const capHoldTotal = teamHolds.reduce(
          (total, row) => total + row.amount,
          0,
        );
        const totalCommitted = payroll + deadMoneyTotal + capHoldTotal;

        return {
          ...team,
          payroll,
          deadMoney: deadMoneyTotal,
          capHolds: capHoldTotal,
          totalCommitted,
          // Null, not a negative number, when no cap has been entered: there
          // is nothing to have room under.
          capSpace: salaryCap > 0 ? salaryCap - totalCommitted : null,
          tier: tierFor(totalCommitted, effective),
          tierLabel: TIER_LABEL[tierFor(totalCommitted, effective)],
          // Rule 3.5 — the floor is tracked and displayed, and carries no
          // penalty in Version 1. It is information, not a breach.
          belowFloor: salaryCap > 0 && totalCommitted < effective.salaryFloor,
          contractCount: teamContracts.length,
          contracts: teamContracts,
          deadMoneyRows: teamDead.map((row) => ({
            id: row.id,
            playerId: row.player.id,
            name: row.player.name,
            amount: row.amount,
            isStretched: row.isStretched,
          })),
          capHoldRows: teamHolds.map((row) => ({
            id: row.id,
            playerId: row.leaguePlayer.player.id,
            name: row.leaguePlayer.player.name,
            amount: row.amount,
            isQualifyingOffer: row.isQualifyingOffer,
          })),
        };
      }),
    };
  }

  /**
   * A team's committed money season by season.
   *
   * Dead money and cap holds run into future seasons just as contracts do, so
   * all three are read across the whole span rather than only for today. The
   * cap itself is one stored number: a league holds no future cap, so every
   * season is measured against the same one and the response says so.
   */
  async outlook(leagueId: number, teamId: number, seasons?: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: {
        season: true,
        settings: { select: { pickTradingWindowDrafts: true } },
      },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    // Rule 12.1 — one window, read in one place. A caller may still ask for
    // a different span, but nothing in the app does.
    const span =
      seasons ?? league.settings?.pickTradingWindowDrafts ?? OUTLOOK_SEASONS;

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: { id: true, name: true, abbr: true, color: true, logo: true },
    });
    if (!team) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Team not found');
    }

    const first =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();
    const last = first + span - 1;

    // Article 2 holds a cap per league year, so every season is measured
    // against its own rather than all of them against today's.
    const capBySeason = new Map(
      await Promise.all(
        Array.from({ length: span }, async (_, index) => {
          const year = first + index;
          const effective = await this.capService.forLeague(leagueId, year);
          return [year, effective] as [number, typeof effective];
        }),
      ),
    );
    const salaryCap = capBySeason.get(first)?.salaryCap ?? 0;

    const [years, dead, holds] = await Promise.all([
      this.prisma.contractYear.findMany({
        where: {
          seasonStartYear: { gte: first, lte: last },
          contract: { leagueId, teamId, isActive: true },
        },
        select: {
          seasonStartYear: true,
          capHit: true,
          // Rule 10.6 and Rule 10.1 — what part of a season's payroll is
          // actually locked in, and what is an option or ungauranteed money
          // the team can still walk away from.
          optionType: true,
          guaranteeType: true,
          contract: {
            select: {
              id: true,
              contractType: true,
              leaguePlayer: {
                select: {
                  id: true,
                  slotType: true,
                  birdYears: true,
                  player: { select: { id: true, name: true, position: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.deadMoney.groupBy({
        by: ['seasonStartYear'],
        where: { leagueId, teamId, seasonStartYear: { gte: first, lte: last } },
        _sum: { amount: true },
      }),
      this.prisma.capHold.groupBy({
        by: ['seasonStartYear'],
        where: { leagueId, teamId, seasonStartYear: { gte: first, lte: last } },
        _sum: { amount: true },
      }),
    ]);

    const deadBySeason = new Map(
      dead.map((row) => [row.seasonStartYear, row._sum.amount ?? 0]),
    );
    const holdsBySeason = new Map(
      holds.map((row) => [row.seasonStartYear, row._sum.amount ?? 0]),
    );

    const payrollBySeason = new Map<number, number>();
    const countBySeason = new Map<number, number>();
    const twoWayBySeason = new Map<number, number>();
    const guaranteedBySeason = new Map<number, number>();
    const playerOptionBySeason = new Map<number, number>();
    const teamOptionBySeason = new Map<number, number>();
    const notGuaranteedBySeason = new Map<number, number>();
    const topEarnersBySeason = new Map<
      number,
      { capHit: number; name: string }[]
    >();

    const addTo = (map: Map<number, number>, key: number, amount: number) =>
      map.set(key, (map.get(key) ?? 0) + amount);

    for (const year of years) {
      addTo(payrollBySeason, year.seasonStartYear, year.capHit);
      if (year.contract.leaguePlayer.slotType === RosterSlotType.twoWay) {
        addTo(twoWayBySeason, year.seasonStartYear, 1);
      } else {
        addTo(countBySeason, year.seasonStartYear, 1);
      }

      // A season belongs to exactly one bucket, so the four always add back
      // up to the payroll and the bar can be drawn straight from them.
      if (year.optionType === ContractOptionType.player) {
        addTo(playerOptionBySeason, year.seasonStartYear, year.capHit);
      } else if (year.optionType === ContractOptionType.team) {
        addTo(teamOptionBySeason, year.seasonStartYear, year.capHit);
      } else if (year.guaranteeType === GuaranteeType.full) {
        addTo(guaranteedBySeason, year.seasonStartYear, year.capHit);
      } else {
        addTo(notGuaranteedBySeason, year.seasonStartYear, year.capHit);
      }

      const earners = topEarnersBySeason.get(year.seasonStartYear) ?? [];
      earners.push({
        capHit: year.capHit,
        name: year.contract.leaguePlayer.player.name,
      });
      topEarnersBySeason.set(year.seasonStartYear, earners);
    }

    /** The three biggest contracts of a season: their share, and whose. */
    const topThree = (season: number, committed: number) => {
      const ranked = [...(topEarnersBySeason.get(season) ?? [])]
        .sort((a, b) => b.capHit - a.capHit)
        .slice(0, 3);
      if (committed <= 0 || ranked.length === 0) {
        return { sharePct: null, names: [] as string[] };
      }
      const total = ranked.reduce((sum, row) => sum + row.capHit, 0);
      return {
        sharePct: Math.round((total / committed) * 1000) / 10,
        // Surnames only: three full names do not fit under a tile, and the
        // surname is what anyone reading a payroll says out loud.
        names: ranked.map(
          (row) => row.name.trim().split(/\s+/).pop() ?? row.name,
        ),
      };
    };

    return {
      team,
      firstSeasonStartYear: first,
      salaryCap,
      // A later season falls back to 0 until the Super Admin enters that league
      // year, and the page shows a dash rather than todays cap.
      capIsCurrentSeasonOnly: false,
      seasons: Array.from({ length: span }, (_, index) => {
        const seasonStartYear = first + index;
        const payroll = payrollBySeason.get(seasonStartYear) ?? 0;
        const deadMoney = deadBySeason.get(seasonStartYear) ?? 0;
        const capHolds = holdsBySeason.get(seasonStartYear) ?? 0;
        const committed = payroll + deadMoney + capHolds;
        const lines = capBySeason.get(seasonStartYear) ?? null;
        const seasonCap = lines?.salaryCap ?? 0;

        // Room under a line, signed. Null only where the league year has no
        // figures at all, which the page shows as a dash.
        const under = (line: number) =>
          seasonCap > 0 ? line - committed : null;

        return {
          seasonStartYear,
          payroll,
          deadMoney,
          capHolds,
          committed,
          salaryCap: seasonCap,
          capSpace: under(seasonCap),
          // Article 3 — the rest of the lines, so the page can draw where
          // this payroll sits rather than only whether it is over the cap.
          salaryFloor: lines?.salaryFloor ?? 0,
          luxuryTax: lines?.luxuryTax ?? 0,
          luxuryTaxRoom: under(lines?.luxuryTax ?? 0),
          firstApron: lines?.firstApron ?? 0,
          firstApronRoom: under(lines?.firstApron ?? 0),
          secondApron: lines?.secondApron ?? 0,
          secondApronRoom: under(lines?.secondApron ?? 0),
          // True when these figures were grown forward rather than entered.
          capIsProjected: lines?.isProjected ?? false,
          guaranteed: guaranteedBySeason.get(seasonStartYear) ?? 0,
          playerOptions: playerOptionBySeason.get(seasonStartYear) ?? 0,
          teamOptions: teamOptionBySeason.get(seasonStartYear) ?? 0,
          notGuaranteed: notGuaranteedBySeason.get(seasonStartYear) ?? 0,
          topThreeSharePct: topThree(seasonStartYear, committed).sharePct,
          topThreeNames: topThree(seasonStartYear, committed).names,
          playerCount: countBySeason.get(seasonStartYear) ?? 0,
          twoWayCount: twoWayBySeason.get(seasonStartYear) ?? 0,
          // Article 6 — what this payroll could still sign with, that
          // season. Nothing is deducted for an exception already spent:
          // that ledger is Article 9, which is not built.
          exceptions: lines ? exceptionsFor(lines, committed) : [],
        };
      }),
    };
  }

  private toContract(row: ContractRow, seasonStartYear: number) {
    const thisSeason =
      row.years.find((year) => year.seasonStartYear === seasonStartYear) ??
      null;

    return {
      id: row.id,
      leaguePlayerId: row.leaguePlayer.id,
      playerId: row.leaguePlayer.playerId,
      name: row.leaguePlayer.player.name,
      position: row.leaguePlayer.player.position,
      type: row.contractType,
      signedVia: row.signedVia,
      slotType: row.leaguePlayer.slotType,
      birdYears: row.leaguePlayer.birdYears,
      yearsOfService: row.leaguePlayer.player.yearsOfService,
      yearsOfServiceEstimated: row.leaguePlayer.player.yearsOfServiceEstimated,
      isRightsHeld: row.leaguePlayer.status === LeaguePlayerStatus.rightsHeld,
      startSeasonStartYear: row.startSeasonStartYear,
      endSeasonStartYear: row.endSeasonStartYear,
      years: row.endSeasonStartYear - row.startSeasonStartYear + 1,
      rfaOnExpiry: row.rfaOnExpiry,
      salary: thisSeason?.salary ?? 0,
      capHit: thisSeason?.capHit ?? 0,
      optionType: thisSeason?.optionType ?? null,
      guaranteeType: thisSeason?.guaranteeType ?? null,
      guaranteedAmount: thisSeason?.guaranteedAmount ?? null,
      seasons: row.years,
    };
  }

  private groupBy<T>(rows: T[], key: (row: T) => number) {
    const out = new Map<number, T[]>();
    for (const row of rows) {
      const id = key(row);
      const list = out.get(id) ?? [];
      list.push(row);
      out.set(id, list);
    }
    return out;
  }
}
