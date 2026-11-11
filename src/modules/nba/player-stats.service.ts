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

/** One row of a career table: a season's averages, and who he played them for. */
export type CareerSeason = SeasonAverage & {
  /** Null when no stored line says which side he was on. "2TM" when traded. */
  team: string | null;
  /** A career table shows it; the nine scoring categories do not include it. */
  fg3Pct: number;
};

/** One line from one game, with the opponent and result a game log prints. */
export type GameLogRow = {
  date: Date;
  opponent: string | null;
  isHome: boolean | null;
  /** Null for a game still in progress, or one whose side is unknown. */
  won: boolean | null;
  teamScore: number | null;
  opponentScore: number | null;
  minutes: string | null;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
  threes: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  fgPct: number;
};

/** What the player card shows under "Game Log (Last 5)". */
const GAME_LOG_LENGTH = 5;

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
   * Every season one player has lines for, newest first.
   *
   * Grouped by season *and* team, then folded, because a player traded in the
   * middle of a season has lines under both: the fold adds the numbers back
   * together and labels the row "2TM", which is what a real career table does
   * rather than picking one of the two. Rows stored before the team column
   * existed carry no team, and those read null.
   */
  async career(playerId: number): Promise<CareerSeason[]> {
    const rows = await this.prisma.playerGameStat.groupBy({
      by: ['season', 'nbaTeamId'],
      where: { playerId },
      _count: { _all: true },
      _sum: {
        pts: true,
        reb: true,
        ast: true,
        stl: true,
        blk: true,
        turnover: true,
        fg3m: true,
        fg3a: true,
        fgm: true,
        fga: true,
        ftm: true,
        fta: true,
      },
    });
    if (rows.length === 0) return [];

    const teamIds = [
      ...new Set(
        rows
          .map((row) => row.nbaTeamId)
          .filter((id): id is number => id !== null),
      ),
    ];
    const teams = await this.prisma.nbaTeam.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, abbreviation: true },
    });
    const abbreviation = new Map(
      teams.map((team) => [team.id, team.abbreviation]),
    );

    type Totals = {
      pts: number;
      reb: number;
      ast: number;
      stl: number;
      blk: number;
      turnover: number;
      fg3m: number;
      fg3a: number;
      fgm: number;
      fga: number;
      ftm: number;
      fta: number;
    };
    const emptyTotals = (): Totals => ({
      pts: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      turnover: 0,
      fg3m: 0,
      fg3a: 0,
      fgm: 0,
      fga: 0,
      ftm: 0,
      fta: 0,
    });

    const bySeason = new Map<
      number,
      { games: number; teams: Set<number>; totals: Totals }
    >();

    for (const row of rows) {
      const bucket = bySeason.get(row.season) ?? {
        games: 0,
        teams: new Set<number>(),
        totals: emptyTotals(),
      };

      bucket.games += row._count._all;
      if (row.nbaTeamId !== null) bucket.teams.add(row.nbaTeamId);

      for (const key of Object.keys(bucket.totals) as (keyof Totals)[]) {
        bucket.totals[key] += row._sum[key] ?? 0;
      }

      bySeason.set(row.season, bucket);
    }

    return [...bySeason.entries()]
      .sort(([a], [b]) => b - a)
      .map(([season, bucket]) => {
        const sum = bucket.totals;
        const games = bucket.games;
        const sides = [...bucket.teams];

        return {
          season,
          team:
            sides.length === 0
              ? null
              : sides.length === 1
                ? (abbreviation.get(sides[0]) ?? null)
                : `${sides.length}TM`,
          gamesPlayed: games,
          pts: perGame(sum.pts, games),
          reb: perGame(sum.reb, games),
          ast: perGame(sum.ast, games),
          stl: perGame(sum.stl, games),
          blk: perGame(sum.blk, games),
          to: perGame(sum.turnover, games),
          threes: perGame(sum.fg3m, games),
          fgPct: percent(sum.fgm, sum.fga),
          ftPct: percent(sum.ftm, sum.fta),
          fg3Pct: percent(sum.fg3m, sum.fg3a),
        };
      });
  }

  /**
   * One player's last few games, newest first.
   *
   * The opponent and the result come from the game and the side he played on,
   * and the line is the only thing that says which side that was. A row stored
   * without a team still shows its own numbers; only the opponent and the
   * result are unknown, and those read null rather than being guessed from the
   * team he plays for today — which is wrong for every season he was traded
   * in, and that is exactly the season somebody is looking at.
   */
  async gameLog(
    playerId: number,
    take = GAME_LOG_LENGTH,
  ): Promise<GameLogRow[]> {
    const rows = await this.prisma.playerGameStat.findMany({
      where: { playerId },
      // The second key breaks a tie between two games on the same night, which
      // a doubleheader date can produce.
      orderBy: [{ gameDate: 'desc' }, { id: 'desc' }],
      take,
      select: {
        gameDate: true,
        minutes: true,
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
        nbaTeamId: true,
        game: {
          select: {
            status: true,
            homeNbaTeamId: true,
            visitorNbaTeamId: true,
            homeTeamScore: true,
            visitorTeamScore: true,
            homeNbaTeam: { select: { abbreviation: true } },
            visitorNbaTeam: { select: { abbreviation: true } },
          },
        },
      },
    });

    return rows.map((row) => {
      const game = row.game;
      const isHome = row.nbaTeamId === game.homeNbaTeamId;
      const isAway = row.nbaTeamId === game.visitorNbaTeamId;
      const known = row.nbaTeamId !== null && (isHome || isAway);

      const own = isHome ? game.homeTeamScore : game.visitorTeamScore;
      const other = isHome ? game.visitorTeamScore : game.homeTeamScore;

      return {
        date: row.gameDate,
        opponent: known
          ? (isHome ? game.visitorNbaTeam : game.homeNbaTeam).abbreviation
          : null,
        isHome: known ? isHome : null,
        // Only a finished game has a result. A line from one in progress is
        // real and is shown; calling it a win would not be.
        won: known && game.status === 'Final' ? own > other : null,
        teamScore: known ? own : null,
        opponentScore: known ? other : null,
        minutes: row.minutes,
        pts: row.pts,
        reb: row.reb,
        ast: row.ast,
        stl: row.stl,
        blk: row.blk,
        to: row.turnover,
        threes: row.fg3m,
        fgm: row.fgm,
        fga: row.fga,
        ftm: row.ftm,
        fta: row.fta,
        fgPct: percent(row.fgm, row.fga),
      };
    });
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
