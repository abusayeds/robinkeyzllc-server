import { HttpStatus, Injectable } from '@nestjs/common';
import { LeaguePlayerStatus, Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import { CapService } from '../cap/cap.service';
import { tierFor, TIER, TIER_LABEL } from '../cap/cap.tiers';

// Tiers moved to the cap engine when the CBA arrived: Article 3 defines five
// of them, with names the rule book uses, and they are read by trades and
// signings as well as by this screen.
export { TIER, TIER_LABEL };

/** How many seasons ahead the payroll outlook runs, matching the import template. */
const OUTLOOK_SEASONS = 6;

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
      player: { select: { name: true, position: true } },
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
  async outlook(leagueId: number, teamId: number, seasons = OUTLOOK_SEASONS) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { season: true, settings: { select: { salaryCap: true } } },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, leagueId },
      select: { id: true, name: true, abbr: true, color: true, logo: true },
    });
    if (!team) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Team not found');
    }

    const first =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();
    const last = first + seasons - 1;
    const salaryCap = league.settings?.salaryCap ?? 0;

    const [years, dead, holds] = await Promise.all([
      this.prisma.contractYear.findMany({
        where: {
          seasonStartYear: { gte: first, lte: last },
          contract: { leagueId, teamId, isActive: true },
        },
        select: {
          seasonStartYear: true,
          capHit: true,
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
    for (const year of years) {
      payrollBySeason.set(
        year.seasonStartYear,
        (payrollBySeason.get(year.seasonStartYear) ?? 0) + year.capHit,
      );
      countBySeason.set(
        year.seasonStartYear,
        (countBySeason.get(year.seasonStartYear) ?? 0) + 1,
      );
    }

    return {
      team,
      firstSeasonStartYear: first,
      // One cap for every season, because a league stores only one. The page
      // says this rather than implying the cap is known years ahead.
      salaryCap,
      capIsCurrentSeasonOnly: true,
      seasons: Array.from({ length: seasons }, (_, index) => {
        const seasonStartYear = first + index;
        const payroll = payrollBySeason.get(seasonStartYear) ?? 0;
        const deadMoney = deadBySeason.get(seasonStartYear) ?? 0;
        const capHolds = holdsBySeason.get(seasonStartYear) ?? 0;
        const committed = payroll + deadMoney + capHolds;

        return {
          seasonStartYear,
          payroll,
          deadMoney,
          capHolds,
          committed,
          capSpace: salaryCap > 0 ? salaryCap - committed : null,
          playerCount: countBySeason.get(seasonStartYear) ?? 0,
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
