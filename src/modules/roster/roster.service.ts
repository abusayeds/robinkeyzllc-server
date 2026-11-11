import { HttpStatus, Injectable } from '@nestjs/common';
import {
  LeaguePlayerStatus,
  LeagueRole,
  Prisma,
  RosterSlotType,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';

const ROSTER_SELECT = {
  id: true,
  playerId: true,
  teamId: true,
  status: true,
  slotType: true,
  birdYears: true,
  player: {
    select: {
      id: true,
      name: true,
      position: true,
      yearsOfService: true,
      yearsOfServiceEstimated: true,
      headshot: true,
      nbaTeam: { select: { abbreviation: true } },
      // One row per player, replaced by each nightly sync, so it is current
      // or absent — and absent means healthy.
      injury: { select: { status: true, returnDate: true } },
    },
  },
  contracts: {
    where: { isActive: true },
    select: {
      id: true,
      contractType: true,
      signedVia: true,
      startSeasonStartYear: true,
      endSeasonStartYear: true,
      rfaOnExpiry: true,
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
    },
  },
} satisfies Prisma.LeaguePlayerSelect;

type RosterRow = Prisma.LeaguePlayerGetPayload<{
  select: typeof ROSTER_SELECT;
}>;

@Injectable()
export class RosterService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every team's roster, measured against the league's own roster rules.
   *
   * Read-only on purpose. A player joins a league through an import, moves
   * through a trade, and leaves through free agency — none of which happen
   * here, so this screen reports rather than edits.
   */
  async list(leagueId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: {
        season: true,
        settings: {
          select: {
            minRosterSize: true,
            maxRosterSize: true,
            maxTwoWay: true,
            slotGuard: true,
            slotForward: true,
            slotCenter: true,
            slotFlex: true,
            slotBench: true,
            slotIr: true,
          },
        },
      },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const seasonStartYear =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();

    const [teams, rows] = await Promise.all([
      this.prisma.team.findMany({
        where: { leagueId },
        select: { id: true, name: true, abbr: true, color: true, logo: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.leaguePlayer.findMany({
        where: { leagueId },
        select: ROSTER_SELECT,
        orderBy: { player: { lastName: 'asc' } },
      }),
    ]);

    const byTeam = new Map<number, RosterRow[]>();
    const unassigned: RosterRow[] = [];
    for (const row of rows) {
      if (row.teamId === null) {
        unassigned.push(row);
        continue;
      }
      const list = byTeam.get(row.teamId) ?? [];
      list.push(row);
      byTeam.set(row.teamId, list);
    }

    const rules = league.settings;

    return {
      seasonStartYear,
      rules,
      teams: teams.map((team) => {
        const roster = (byTeam.get(team.id) ?? []).map((row) =>
          this.toPlayer(row, seasonStartYear),
        );

        // Players whose rights are held take no roster spot, so they are
        // counted apart from everyone else.
        const rostered = roster.filter(
          (p) => p.status === LeaguePlayerStatus.rostered,
        );
        const standard = rostered.filter(
          (p) => p.slotType === RosterSlotType.standard,
        ).length;
        const twoWay = rostered.filter(
          (p) => p.slotType === RosterSlotType.twoWay,
        ).length;
        const injuredReserve = rostered.filter(
          (p) => p.slotType === RosterSlotType.injuredReserve,
        ).length;

        const warnings: string[] = [];
        if (rules) {
          if (standard > rules.maxRosterSize) {
            warnings.push(
              `${standard} players on a roster capped at ${rules.maxRosterSize}.`,
            );
          }
          if (standard < rules.minRosterSize) {
            warnings.push(
              `${standard} players, ${rules.minRosterSize - standard} short of the ${rules.minRosterSize} minimum.`,
            );
          }
          if (twoWay > rules.maxTwoWay) {
            warnings.push(
              `${twoWay} two-way contracts, ${rules.maxTwoWay} allowed.`,
            );
          }
          if (injuredReserve > rules.slotIr) {
            warnings.push(
              `${injuredReserve} on injured reserve, ${rules.slotIr} allowed.`,
            );
          }
        }

        return {
          ...team,
          counts: {
            standard,
            twoWay,
            injuredReserve,
            rightsHeld: roster.filter(
              (p) => p.status === LeaguePlayerStatus.rightsHeld,
            ).length,
            total: roster.length,
          },
          warnings,
          players: roster,
        };
      }),
      // Anyone the league holds who is not on a team. Empty until free agency
      // exists, but a roster screen that silently omitted them would be lying.
      unassigned: unassigned.map((row) => this.toPlayer(row, seasonStartYear)),
    };
  }

  /**
   * One team in full: its roster, its own cap position, and the rules it is
   * measured against. Kept as a single read so the payroll on the card and the
   * contracts in the table are the same moment.
   */
  async team(leagueId: number, teamId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { season: true, settings: true },
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
        intelStatus: true,
        members: {
          select: {
            role: true,
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

    const [rows, dead, holds] = await Promise.all([
      this.prisma.leaguePlayer.findMany({
        where: { leagueId, teamId },
        select: ROSTER_SELECT,
        orderBy: { player: { lastName: 'asc' } },
      }),
      this.prisma.deadMoney.findMany({
        where: { leagueId, teamId, seasonStartYear },
        select: {
          id: true,
          amount: true,
          isStretched: true,
          player: { select: { id: true, name: true } },
        },
      }),
      this.prisma.capHold.findMany({
        where: { leagueId, teamId, seasonStartYear },
        select: {
          id: true,
          amount: true,
          isQualifyingOffer: true,
          leaguePlayer: {
            select: { player: { select: { id: true, name: true } } },
          },
        },
      }),
    ]);

    const players = rows.map((row) => this.toPlayer(row, seasonStartYear));
    const rostered = players.filter(
      (p) => p.status === LeaguePlayerStatus.rostered,
    );

    const payroll = players.reduce((total, p) => total + (p.capHit ?? 0), 0);
    const deadTotal = dead.reduce((total, row) => total + row.amount, 0);
    const holdTotal = holds.reduce((total, row) => total + row.amount, 0);
    const salaryCap = league.settings?.salaryCap ?? 0;
    const committed = payroll + deadTotal + holdTotal;

    return {
      seasonStartYear,
      rules: league.settings,
      team: {
        ...team,
        owner: team.members.find((m) => m.role === 'owner')?.user ?? null,
        coOwner: team.members.find((m) => m.role === 'coOwner')?.user ?? null,
      },
      counts: {
        standard: rostered.filter((p) => p.slotType === RosterSlotType.standard)
          .length,
        twoWay: rostered.filter((p) => p.slotType === RosterSlotType.twoWay)
          .length,
        injuredReserve: rostered.filter(
          (p) => p.slotType === RosterSlotType.injuredReserve,
        ).length,
        rightsHeld: players.filter(
          (p) => p.status === LeaguePlayerStatus.rightsHeld,
        ).length,
      },
      cap: {
        salaryCap,
        payroll,
        deadMoney: deadTotal,
        capHolds: holdTotal,
        committed,
        capSpace: salaryCap > 0 ? salaryCap - committed : null,
      },
      deadMoneyRows: dead.map((row) => ({
        id: row.id,
        playerId: row.player.id,
        name: row.player.name,
        amount: row.amount,
        isStretched: row.isStretched,
      })),
      capHoldRows: holds.map((row) => ({
        id: row.id,
        playerId: row.leaguePlayer.player.id,
        name: row.leaguePlayer.player.name,
        amount: row.amount,
        isQualifyingOffer: row.isQualifyingOffer,
      })),
      players,
    };
  }

  /**
   * Moves a player between the active roster and injured reserve.
   *
   * The only roster change this screen can honestly make: a trade needs two
   * teams, a release needs waiver and dead-money rules, and a starting lineup
   * needs games to start. Those arrive with their own models.
   */
  async setSlot(
    leagueId: number,
    teamId: number,
    leaguePlayerId: number,
    slotType: RosterSlotType,
    userId: number,
  ) {
    await this.assertMayManage(leagueId, teamId, userId);

    const row = await this.prisma.leaguePlayer.findFirst({
      where: { id: leaguePlayerId, leagueId, teamId },
      select: {
        id: true,
        slotType: true,
        status: true,
        player: { select: { name: true } },
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
    // A two-way contract carries its own slot type, and moving it would make
    // the contract and the roster disagree about what it is.
    if (row.slotType === RosterSlotType.twoWay) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'A two-way player cannot be moved between roster slots.',
      );
    }
    if (slotType === RosterSlotType.twoWay) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Two-way status comes from the contract, not from a roster move.',
      );
    }

    const settings = await this.prisma.leagueSettings.findUnique({
      where: { leagueId },
      select: { slotIr: true, maxRosterSize: true },
    });

    if (slotType === RosterSlotType.injuredReserve && settings) {
      const onIr = await this.prisma.leaguePlayer.count({
        where: {
          leagueId,
          teamId,
          status: LeaguePlayerStatus.rostered,
          slotType: RosterSlotType.injuredReserve,
        },
      });
      if (onIr >= settings.slotIr) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          `This league allows ${settings.slotIr} players on injured reserve.`,
        );
      }
    }

    await this.prisma.leaguePlayer.update({
      where: { id: leaguePlayerId },
      data: { slotType },
    });

    return this.team(leagueId, teamId);
  }

  /**
   * Who may change a team's roster: the people who hold that team, and the
   * league's commissioners.
   *
   * LeagueGuard only proves membership of the league, which every manager
   * has. Without this, any member could move another team's player.
   */
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
        "Only this team's owner or a commissioner can change its roster.",
      );
    }
  }

  private toPlayer(row: RosterRow, seasonStartYear: number) {
    const contract = row.contracts[0] ?? null;
    const thisSeason =
      contract?.years.find((y) => y.seasonStartYear === seasonStartYear) ??
      null;

    return {
      id: row.id,
      playerId: row.playerId,
      name: row.player.name,
      position: row.player.position,
      nbaTeam: row.player.nbaTeam?.abbreviation ?? null,
      experience: row.player.yearsOfService,
      experienceIsEstimated: row.player.yearsOfServiceEstimated,
      headshot: row.player.headshot,
      injury: row.player.injury,
      birdYears: row.birdYears,
      status: row.status,
      slotType: row.slotType,
      contract: contract
        ? {
            id: contract.id,
            type: contract.contractType,
            signedVia: contract.signedVia,
            startSeasonStartYear: contract.startSeasonStartYear,
            endSeasonStartYear: contract.endSeasonStartYear,
            years:
              contract.endSeasonStartYear - contract.startSeasonStartYear + 1,
            rfaOnExpiry: contract.rfaOnExpiry,
            seasons: contract.years,
          }
        : null,
      // Null, not 0: a player with no contract this season is different from
      // one carried at zero, which is what a two-way deal is.
      salary: thisSeason?.salary ?? null,
      capHit: thisSeason?.capHit ?? null,
    };
  }
}
