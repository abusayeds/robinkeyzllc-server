import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Season averages, worked out from the game lines already stored.
 *
 * Not a table of its own and not a second sync. balldontlie does have a
 * season-averages endpoint, but its `stats` object changes shape with the
 * category asked for, and a column filled from keys nobody has confirmed is
 * worse than a column filled from arithmetic. `PlayerGameStat` holds every
 * line the nightly job has pulled, so the average is exact and there is only
 * one thing that can be out of date.
 *
 * A season played before AVORA started syncing has no lines, so it has no
 * averages. `POST /nba/sync/backfill` is how that is fixed.
 */
export type SeasonAverage = {
  season: number;
  gamesPlayed: number;
  /** Per game, to one decimal — what a draft board shows. */
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
  threes: number;
  /** Whole percent. Makes over attempts for the season, not an average of games. */
  fgPct: number;
  ftPct: number;
};

const perGame = (total: number, games: number) =>
  games > 0 ? Math.round((total / games) * 10) / 10 : 0;

const percent = (makes: number, attempts: number) =>
  attempts > 0 ? Math.round((makes / attempts) * 1000) / 10 : 0;

@Injectable()
export class PlayerStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The most recent season any lines exist for, or null when none do. */
  async latestSeason(): Promise<number | null> {
    const row = await this.prisma.playerGameStat.aggregate({
      _max: { season: true },
    });
    return row._max.season ?? null;
  }

  /**
   * One season's averages for a set of players, by player id.
   *
   * Grouped in the database rather than in memory: a draft pool page asks
   * about fifty players at a time and a whole season is eighty-odd lines each.
   */
  async seasonAverages(
    playerIds: number[],
    season: number,
  ): Promise<Map<number, SeasonAverage>> {
    const result = new Map<number, SeasonAverage>();
    if (playerIds.length === 0) return result;

    const rows = await this.prisma.playerGameStat.groupBy({
      by: ['playerId'],
      where: { playerId: { in: playerIds }, season },
      _count: { _all: true },
      _sum: {
        pts: true,
        reb: true,
        ast: true,
        stl: true,
        blk: true,
        turnover: true,
        fg3m: true,
        fgm: true,
        fga: true,
        ftm: true,
        fta: true,
      },
    });

    for (const row of rows) {
      const games = row._count._all;
      const sum = row._sum;

      result.set(row.playerId, {
        season,
        gamesPlayed: games,
        pts: perGame(sum.pts ?? 0, games),
        reb: perGame(sum.reb ?? 0, games),
        ast: perGame(sum.ast ?? 0, games),
        stl: perGame(sum.stl ?? 0, games),
        blk: perGame(sum.blk ?? 0, games),
        to: perGame(sum.turnover ?? 0, games),
        threes: perGame(sum.fg3m ?? 0, games),
        // Season makes over season attempts, for the same reason weekly
        // percentages are worked out that way (see `scoring.rules.ts`).
        fgPct: percent(sum.fgm ?? 0, sum.fga ?? 0),
        ftPct: percent(sum.ftm ?? 0, sum.fta ?? 0),
      });
    }

    return result;
  }

  /**
   * The season a draft board should show.
   *
   * The season before the one being drafted for — a draft is picked on what a
   * player just did — falling back to the newest season with any lines at all,
   * which is what a league drafting mid-season or before a backfill gets.
   */
  async seasonForDraft(seasonStartYear: number): Promise<number | null> {
    const wanted = seasonStartYear - 1;

    const has = await this.prisma.playerGameStat.count({
      where: { season: wanted },
    });
    if (has > 0) return wanted;

    return this.latestSeason();
  }
}
