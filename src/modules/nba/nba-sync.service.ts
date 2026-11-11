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
