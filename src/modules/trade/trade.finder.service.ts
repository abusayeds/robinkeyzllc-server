import { HttpStatus, Injectable } from '@nestjs/common';
import { LeaguePlayerStatus, RosterSlotType } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import {
  PlayerStatsService,
  type SeasonAverage,
} from '../nba/player-stats.service';

/**
 * Every player another team could trade you.
 *
 * Its own service rather than a flag on the roster list: that list is read by
 * the commissioner's roster screen and by the header search, and neither wants
 * a season's averages for three hundred players attached to it.
 */

/** Whole years between a birthdate and today, in UTC so it cannot drift. */
function ageFrom(birthdate: Date | null): number | null {
  if (!birthdate) return null;

  const today = new Date();
  let age = today.getUTCFullYear() - birthdate.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birthdate.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getUTCDate() < birthdate.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

@Injectable()
export class TradeFinderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playerStats: PlayerStatsService,
  ) {}

  async listing(leagueId: number, userId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { season: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const seasonStartYear =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();

    const membership = await this.prisma.teamMember.findFirst({
      where: { leagueId, userId },
      select: { teamId: true },
    });
    const myTeamId = membership?.teamId ?? null;

    const rows = await this.prisma.leaguePlayer.findMany({
      where: {
        leagueId,
        teamId: { not: null },
        status: LeaguePlayerStatus.rostered,
        // A two-way player cannot be traded for salary purposes and an
        // injured-reserve slot is not a trade asset, so neither belongs on a
        // board of players to go after.
        slotType: RosterSlotType.standard,
      },
      orderBy: { player: { lastName: 'asc' } },
      select: {
        id: true,
        playerId: true,
        player: {
          select: {
            id: true,
            name: true,
            position: true,
            birthdate: true,
            headshot: true,
            nbaTeam: { select: { abbreviation: true } },
          },
        },
        team: { select: { id: true, name: true, abbr: true, logo: true } },
        contracts: {
          where: { isActive: true },
          select: {
            startSeasonStartYear: true,
            endSeasonStartYear: true,
            years: {
              where: { seasonStartYear },
              select: { salary: true, capHit: true },
            },
          },
          take: 1,
        },
      },
    });

    // A board is read on what a player just did, so the averages come from the
    // season before this one — the same rule the draft pool uses.
    const statsSeason = await this.playerStats.seasonForDraft(seasonStartYear);
    const averages = statsSeason
      ? await this.playerStats.seasonAverages(
          rows.map((row) => row.playerId),
          statsSeason,
        )
      : new Map<number, SeasonAverage>();

    const players = rows.map((row) => {
      const contract = row.contracts[0] ?? null;
      const thisSeason = contract?.years[0] ?? null;
      const stats = averages.get(row.playerId) ?? null;

      return {
        id: row.id,
        playerId: row.player.id,
        name: row.player.name,
        position: row.player.position,
        nbaTeam: row.player.nbaTeam?.abbreviation ?? null,
        headshot: row.player.headshot,
        team: row.team,
        /** Null until a Super Admin has imported the birthdate. */
        age: ageFrom(row.player.birthdate),
        salary: thisSeason?.salary ?? null,
        capHit: thisSeason?.capHit ?? null,
        years: contract
          ? contract.endSeasonStartYear - contract.startSeasonStartYear + 1
          : 0,
        /** Null when no lines have been synced for the season. */
        stats,
        isMine: myTeamId !== null && row.team?.id === myTeamId,
      };
    });

    return {
      seasonStartYear,
      statsSeason,
      myTeamId,
      players,
    };
  }
}
