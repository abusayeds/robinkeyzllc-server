import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { SyncJob, SyncStatus } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePlayerName } from '../player/player.normalize';
import { BalldontlieClient, BdlTeam } from './balldontlie.client';

/**
 * balldontlie sends a game's date as an ISO instant. A game belongs to the
 * night it was played, not to whatever time of day that instant lands on in
 * the reader's zone, so only the date part is kept.
 */
const dateOnly = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);

/**
 * Between season-average requests, for the same reason `paginate` waits
 * between pages: a career walk is a few hundred requests and should leave
 * room for the nightly job running beside it.
 */
const AVERAGES_DELAY_MS = 150;

/**
 * How far back a career walk looks for a player the feed carries no draft
 * year for — undrafted, international, or a row an import created before any
 * sync reached him. Twenty-five seasons covers every active career without
 * asking for the 1980s on every run.
 */
const CAREER_MAX_SEASONS = 25;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class NbaSyncService {
  private readonly logger = new Logger(NbaSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bdl: BalldontlieClient,
  ) {}

  /**
   * The 30 NBA teams. Run before players: a player row points at a team, and
   * a player synced first would have nothing to point at.
   */
  async syncTeams() {
    return this.run(SyncJob.teams, async (record) => {
      for await (const { rows, cursor } of this.bdl.teams()) {
        for (const team of rows) {
          await this.upsertTeam(team, record);
        }
        record.cursor = cursor;
      }
    });
  }

  /**
   * Every active NBA player.
   *
   * Upserts on `bdlPlayerId`, so running it again updates rather than
   * duplicates — which is what makes it safe to re-run after a failure.
   */
  async syncPlayers(resumeCursor?: string) {
    return this.run(SyncJob.players, async (record) => {
      const teamIds = await this.teamIdsByBdlId();

      for await (const { rows, cursor } of this.bdl.activePlayers(
        resumeCursor,
      )) {
        for (const player of rows) {
          const name = `${player.first_name} ${player.last_name}`.trim();
          if (!name) {
            record.skipped += 1;
            continue;
          }

          const data = {
            firstName: player.first_name ?? '',
            lastName: player.last_name ?? '',
            name,
            nameNormalized: normalizePlayerName(name),
            position: player.position?.trim() || null,
            height: player.height?.trim() || null,
            weight: player.weight?.trim() || null,
            college: player.college?.trim() || null,
            country: player.country?.trim() || null,
            draftYear: player.draft_year ?? null,
            draftRound: player.draft_round ?? null,
            draftNumber: player.draft_number ?? null,
            nbaTeamId: player.team
              ? (teamIds.get(player.team.id) ?? null)
              : null,
            isActive: true,
            syncedAt: new Date(),
          };

          const existing = await this.prisma.player.findUnique({
            where: { bdlPlayerId: player.id },
            select: { id: true },
          });

          if (existing) {
            await this.prisma.player.update({
              where: { id: existing.id },
              data,
            });
            record.updated += 1;
          } else {
            await this.prisma.player.create({
              data: { ...data, bdlPlayerId: player.id },
            });
            record.created += 1;
          }
        }
        record.cursor = cursor;
      }
    });
  }

  /**
   * Real NBA games between two dates.
   *
   * Free tier, and run ahead of the stat sync: a line belongs to a game, so
   * the game row has to exist before it. Dates are inclusive and in the
   * league's own calendar sense — `YYYY-MM-DD`, no time zone.
   */
  async syncGames(startDate: string, endDate: string) {
    return this.run(SyncJob.games, async (record) => {
      const teamIds = await this.teamIdsByBdlId();

      for await (const { rows, cursor } of this.bdl.games(startDate, endDate)) {
        for (const game of rows) {
          const home = teamIds.get(game.home_team?.id ?? -1);
          const visitor = teamIds.get(game.visitor_team?.id ?? -1);

          // A game whose teams have not been synced yet is skipped rather
          // than invented: run the team sync and this one again.
          if (!home || !visitor) {
            record.skipped += 1;
            continue;
          }

          await this.upsertGame(game, home, visitor, record);
        }
        record.cursor = cursor;
      }
    });
  }

  /**
   * Every player line from one date.
   *
   * One request per date — `/v1/box_scores` returns the whole night — and safe
   * to repeat: both the game and each line upsert on a natural key, so running
   * a date again after a game finishes replaces the partial line rather than
   * adding a second one.
   */
  async syncStats(date: string) {
    return this.run(SyncJob.stats, async (record) => {
      const [teamIds, games] = await Promise.all([
        this.teamIdsByBdlId(),
        this.bdl.boxScores(date),
      ]);

      if (games.length === 0) return;

      // One lookup for the whole night instead of one per line. A line names
      // its player by balldontlie's id, and a player the sync has never seen
      // has no row to hang a stat on.
      const bdlPlayerIds = new Set<number>();
      for (const game of games) {
        for (const line of [
          ...(game.home_team?.players ?? []),
          ...(game.visitor_team?.players ?? []),
        ]) {
          if (line.player?.id) bdlPlayerIds.add(line.player.id);
        }
      }

      const players = await this.prisma.player.findMany({
        where: { bdlPlayerId: { in: [...bdlPlayerIds] } },
        select: { id: true, bdlPlayerId: true },
      });
      const playerIds = new Map(
        players.map((player) => [player.bdlPlayerId as number, player.id]),
      );

      for (const game of games) {
        const home = teamIds.get(game.home_team?.id ?? -1);
        const visitor = teamIds.get(game.visitor_team?.id ?? -1);
        if (!home || !visitor) {
          record.skipped += 1;
          continue;
        }

        const gameRow = await this.upsertGame(
          {
            id: game.id,
            date: game.date,
            season: game.season,
            status: game.status,
            period: 0,
            postseason: game.postseason,
            home_team_score: game.home_team_score,
            visitor_team_score: game.visitor_team_score,
          },
          home,
          visitor,
          { created: 0, updated: 0, skipped: 0, cursor: null },
        );

        // Flattening both sides into one list would throw away the only
        // thing that says which team a player appeared for, so each side is
        // walked with its own team id.
        const sides = [
          { nbaTeamId: home, lines: game.home_team?.players ?? [] },
          { nbaTeamId: visitor, lines: game.visitor_team?.players ?? [] },
        ];

        for (const { nbaTeamId, lines } of sides) {
          for (const line of lines) {
            const playerId = playerIds.get(line.player?.id ?? -1);
            if (!playerId) {
              record.skipped += 1;
              continue;
            }

            const data = {
              nbaTeamId,
              gameDate: dateOnly(game.date),
              season: game.season,
              minutes: line.min?.trim() || null,
              fgm: line.fgm ?? 0,
              fga: line.fga ?? 0,
              ftm: line.ftm ?? 0,
              fta: line.fta ?? 0,
              fg3m: line.fg3m ?? 0,
              fg3a: line.fg3a ?? 0,
              pts: line.pts ?? 0,
              reb: line.reb ?? 0,
              oreb: line.oreb ?? 0,
              dreb: line.dreb ?? 0,
              ast: line.ast ?? 0,
              stl: line.stl ?? 0,
              blk: line.blk ?? 0,
              turnover: line.turnover ?? 0,
              pf: line.pf ?? 0,
            };

            const existing = await this.prisma.playerGameStat.findUnique({
              where: { playerId_gameId: { playerId, gameId: gameRow.id } },
              select: { id: true },
            });

            if (existing) {
              await this.prisma.playerGameStat.update({
                where: { id: existing.id },
                data,
              });
              record.updated += 1;
            } else {
              await this.prisma.playerGameStat.create({
                data: { ...data, playerId, gameId: gameRow.id },
              });
              record.created += 1;
            }
          }
        }
      }
    });
  }

  private async upsertGame(
    game: {
      id: number;
      date: string;
      season: number;
      status: string;
      period?: number;
      postseason: boolean;
      home_team_score: number;
      visitor_team_score: number;
    },
    homeNbaTeamId: number,
    visitorNbaTeamId: number,
    record: Tally,
  ) {
    const data = {
      date: dateOnly(game.date),
      season: game.season,
      status: game.status,
      period: game.period ?? 0,
      postseason: game.postseason,
      homeTeamScore: game.home_team_score ?? 0,
      visitorTeamScore: game.visitor_team_score ?? 0,
      homeNbaTeamId,
      visitorNbaTeamId,
      syncedAt: new Date(),
    };

    const existing = await this.prisma.nbaGame.findUnique({
      where: { bdlGameId: game.id },
      select: { id: true },
    });

    if (existing) {
      record.updated += 1;
      return this.prisma.nbaGame.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      });
    }

    record.created += 1;
    return this.prisma.nbaGame.create({
      data: { ...data, bdlGameId: game.id },
      select: { id: true },
    });
  }

  /**
   * Every night between two dates, games then lines.
   *
   * A whole NBA season is about 170 nights, which is 170 requests — nothing
   * against GOAT's 600 a minute. This is how a league gets last season's
   * numbers for a startup draft board, and how a gap after downtime is
   * filled: every step upserts, so a night already synced costs a request
   * and changes nothing.
   */
  async backfill(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);

    if (end < start) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'The end date falls before the start date.',
      );
    }

    const games = await this.syncGames(startDate, endDate);

    const nights: string[] = [];
    for (
      const cursor = new Date(start);
      cursor <= end;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      nights.push(cursor.toISOString().slice(0, 10));
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const failed: string[] = [];

    for (const night of nights) {
      try {
        const run = await this.syncStats(night);
        created += run.created;
        updated += run.updated;
        skipped += run.skipped;
      } catch {
        // One bad night must not lose the rest of the range. Each failure
        // has already written its own SyncRun row saying what happened.
        failed.push(night);
      }
    }

    return {
      nights: nights.length,
      gamesCreated: games.created,
      gamesUpdated: games.updated,
      linesCreated: created,
      linesUpdated: updated,
      linesSkipped: skipped,
      failedNights: failed,
    };
  }
  /**
   * Who is hurt right now.
   *
   * The feed is the whole truth each time it is read, so a player it stops
   * returning is healthy again — which is why this deletes the rows it did
   * not see rather than leaving yesterday's injuries on the board forever.
   */
  /**
   * A season's averages, straight from the feed.
   *
   * Only players some league actually rosters: the pool runs to thousands and
   * nobody reads a card for a player nobody owns. A hundred ids per request,
   * which is the endpoint's own ceiling.
   */
  async syncSeasonAverages(season: number) {
    return this.run(SyncJob.seasonAverages, async (record) => {
      const players = await this.rosteredPlayers();
      if (players.length === 0) return;

      const idByBdl = new Map(
        players.map((player) => [player.bdlPlayerId as number, player.id]),
      );

      await this.storeSeasonAverages(season, idByBdl, record);
    });
  }

  /**
   * Every season each rostered player has played, not only the current one.
   *
   * A player card's career table was showing a single line because the only
   * figures in the database were this season's, and the stored game lines go
   * back no further than the day this deployment started pulling. The feed
   * answers one season per request, so a career is walked backwards from the
   * current season, and a player is only asked for in the seasons he could
   * have played — his draft year is the floor.
   *
   * Every season is independent: one the feed refuses is logged and the walk
   * carries on, because losing twenty good seasons to one bad one would mean
   * starting the whole thing again.
   */
  async syncCareerAverages(fromSeason?: number) {
    return this.run(SyncJob.careerAverages, async (record) => {
      const current = await this.currentSeason();
      if (current === null) {
        throw new AppError(
          HttpStatus.FAILED_DEPENDENCY,
          'No NBA games have been synced yet, so there is no season to count back from. Run a games sync first, or pass ?from=YYYY.',
        );
      }

      const players = await this.rosteredPlayers();
      if (players.length === 0) return;

      const idByBdl = new Map(
        players.map((player) => [player.bdlPlayerId as number, player.id]),
      );

      const floor = fromSeason ?? current - CAREER_MAX_SEASONS;

      // Every season is walked for the whole league and matched against the
      // rostered players afterwards, so there is nothing to work out per
      // player here: a man who did not play a season simply has no row in it.
      for (let season = current; season >= floor; season -= 1) {
        try {
          await this.storeSeasonAverages(season, idByBdl, record);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown failure';
          this.logger.warn(`Career sync skipped season ${season}: ${message}`);
        }

        await sleep(AVERAGES_DELAY_MS);
      }

      await this.deriveYearsOfService(current);
    });
  }

  /** The season the newest stored game belongs to, as balldontlie numbers them. */
  async currentSeason(): Promise<number | null> {
    const latest = await this.prisma.nbaGame.findFirst({
      orderBy: { date: 'desc' },
      select: { season: true },
    });
    return latest?.season ?? null;
  }

  /**
   * Only the players some league actually rosters. The pool runs to thousands
   * and nobody reads a card for a player nobody owns, so asking for the rest
   * would be hundreds of requests for figures no screen shows.
   */
  private rosteredPlayers() {
    return this.prisma.player.findMany({
      where: { bdlPlayerId: { not: null }, leaguePlayers: { some: {} } },
      select: { id: true, bdlPlayerId: true, draftYear: true },
    });
  }

  /**
   * One season's averages, kept for the players some league rosters.
   *
   * The feed is walked for the whole league and filtered here rather than
   * asked player by player: the endpoint pages at a hundred whatever ids are
   * passed, so a filtered request is the same number of round trips with a
   * chance of quietly dropping people.
   */
  private async storeSeasonAverages(
    season: number,
    idByBdl: Map<number, number>,
    record: Tally,
  ) {
    // The feed sends percentages as a fraction; every screen in the app shows
    // them out of a hundred.
    const asPercent = (value: number | null) =>
      value === null ? 0 : Math.round(value * 1000) / 10;

    for await (const { rows } of this.bdl.seasonAverages(season)) {
      for (const row of rows) {
        const playerId = idByBdl.get(row.player?.id);
        const stats = row.stats;

        // No games played is a row for a man who was on a roster and did not
        // play. There is nothing to average, and writing zeroes would put him
        // on a career table as though he had.
        if (!playerId || !stats?.gp) {
          record.skipped += 1;
          continue;
        }

        const data = {
          gamesPlayed: stats.gp,
          // Minutes per game, as a number here and a string in the column:
          // nothing calculates on it and a box score's "32:14" shares it.
          minutes: stats.min === null ? null : String(stats.min),
          pts: stats.pts ?? 0,
          reb: stats.reb ?? 0,
          ast: stats.ast ?? 0,
          stl: stats.stl ?? 0,
          blk: stats.blk ?? 0,
          to: stats.tov ?? 0,
          fg3m: stats.fg3m ?? 0,
          fgPct: asPercent(stats.fg_pct),
          ftPct: asPercent(stats.ft_pct),
          fg3Pct: stats.fg3_pct === null ? null : asPercent(stats.fg3_pct),
          // The only age the feed gives on any tier. A birthdate is still the
          // better answer because it stays right all season; this is what a
          // card shows until one has been imported.
          age: stats.age ?? null,
          fetchedAt: new Date(),
        };

        await this.prisma.playerSeasonAverage.upsert({
          where: { playerId_season: { playerId, season } },
          create: { playerId, season, ...data },
          update: data,
        });
        record.updated += 1;
      }
    }
  }

  /**
   * Years of service, counted off the career rows a career sync just wrote.
   *
   * Rule 10's minimum and maximum scales are read off this number, and until
   * now nothing filled it: the column sat null and every card showed a dash
   * for experience. A completed season with at least one game played is a
   * year of service, so the current season is not counted — it is not over.
   *
   * A figure a commissioner typed in by hand is left alone. Only a null, or
   * one still marked estimated, is written over.
   */
  private async deriveYearsOfService(currentSeason: number) {
    const counts = await this.prisma.playerSeasonAverage.groupBy({
      by: ['playerId'],
      where: { season: { lt: currentSeason }, gamesPlayed: { gt: 0 } },
      _count: { _all: true },
    });

    for (const row of counts) {
      await this.prisma.player.updateMany({
        where: {
          id: row.playerId,
          OR: [{ yearsOfService: null }, { yearsOfServiceEstimated: true }],
        },
        data: {
          yearsOfService: row._count._all,
          yearsOfServiceEstimated: false,
        },
      });
    }
  }

  async syncInjuries() {
    return this.run(SyncJob.injuries, async (record) => {
      const rows: {
        bdlPlayerId: number;
        status: string;
        description: string | null;
        returnDate: Date | null;
      }[] = [];

      for await (const { rows: page, cursor } of this.bdl.playerInjuries()) {
        for (const injury of page) {
          if (!injury.player?.id || !injury.status?.trim()) {
            record.skipped += 1;
            continue;
          }
          rows.push({
            bdlPlayerId: injury.player.id,
            status: injury.status.trim(),
            description: injury.description?.trim() || null,
            returnDate: injury.return_date
              ? dateOnly(injury.return_date)
              : null,
          });
        }
        record.cursor = cursor;
      }

      const players = await this.prisma.player.findMany({
        where: { bdlPlayerId: { in: rows.map((row) => row.bdlPlayerId) } },
        select: { id: true, bdlPlayerId: true },
      });
      const playerIds = new Map(
        players.map((player) => [player.bdlPlayerId as number, player.id]),
      );

      const seen: number[] = [];

      for (const row of rows) {
        const playerId = playerIds.get(row.bdlPlayerId);
        if (!playerId) {
          // A player this platform has never synced. Run the player sync.
          record.skipped += 1;
          continue;
        }

        const data = {
          status: row.status,
          description: row.description,
          returnDate: row.returnDate,
          syncedAt: new Date(),
        };

        const existing = await this.prisma.playerInjury.findUnique({
          where: { playerId },
          select: { id: true },
        });

        if (existing) {
          await this.prisma.playerInjury.update({
            where: { id: existing.id },
            data,
          });
          record.updated += 1;
        } else {
          await this.prisma.playerInjury.create({
            data: { ...data, playerId },
          });
          record.created += 1;
        }

        seen.push(playerId);
      }

      // Only when the feed actually answered. An empty response from a
      // failing API must not clear the whole board.
      if (seen.length > 0) {
        await this.prisma.playerInjury.deleteMany({
          where: { playerId: { notIn: seen } },
        });
      }
    });
  }
  async history(limit = 20) {
    return this.prisma.syncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  private async upsertTeam(team: BdlTeam, record: Tally) {
    // balldontlie sends "    " rather than null for a defunct franchise, so
    // trimming is what turns a blank into an absent value.
    const conference = team.conference?.trim() || null;
    const division = team.division?.trim() || null;

    const data = {
      abbreviation: team.abbreviation,
      city: team.city,
      name: team.name,
      fullName: team.full_name,
      conference,
      division,
      // Only the 30 current franchises carry a conference. The rest are
      // historical — the Toronto Huskies played one season in 1946 — and are
      // kept rather than dropped, because a player's record can point at one.
      isCurrent: conference === 'East' || conference === 'West',
      syncedAt: new Date(),
    };

    const existing = await this.prisma.nbaTeam.findUnique({
      where: { bdlTeamId: team.id },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.nbaTeam.update({ where: { id: existing.id }, data });
      record.updated += 1;
    } else {
      await this.prisma.nbaTeam.create({
        data: { ...data, bdlTeamId: team.id },
      });
      record.created += 1;
    }
  }

  private async teamIdsByBdlId() {
    const teams = await this.prisma.nbaTeam.findMany({
      select: { id: true, bdlTeamId: true },
    });
    return new Map(teams.map((team) => [team.bdlTeamId, team.id]));
  }

  /**
   * Wraps a job in its own `SyncRun` row.
   *
   * The row is written before the work starts and closed after, so a run that
   * crashes is left visibly `running` with its last cursor rather than
   * disappearing. A later run can pick that cursor up.
   */
  private async run(job: SyncJob, work: (record: Tally) => Promise<void>) {
    if (!this.bdl.isConfigured) {
      throw new AppError(
        HttpStatus.FAILED_DEPENDENCY,
        'No balldontlie API key is configured, so there is nothing to sync from.',
      );
    }

    const started = await this.prisma.syncRun.create({
      data: { job, status: SyncStatus.running },
      select: { id: true },
    });

    const record: Tally = { created: 0, updated: 0, skipped: 0, cursor: null };

    try {
      await work(record);

      return await this.prisma.syncRun.update({
        where: { id: started.id },
        data: {
          status: SyncStatus.succeeded,
          finishedAt: new Date(),
          created: record.created,
          updated: record.updated,
          skipped: record.skipped,
          cursor: record.cursor,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown sync failure';
      this.logger.error(`${job} sync failed: ${message}`);

      await this.prisma.syncRun.update({
        where: { id: started.id },
        data: {
          status: SyncStatus.failed,
          finishedAt: new Date(),
          created: record.created,
          updated: record.updated,
          skipped: record.skipped,
          // Kept so the next run can carry on from where this one stopped
          // instead of walking everything again.
          cursor: record.cursor,
          error: message,
        },
      });

      throw error;
    }
  }
}

type Tally = {
  created: number;
  updated: number;
  skipped: number;
  cursor: string | null;
};
