import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { SyncJob, SyncStatus } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePlayerName } from '../player/player.normalize';
import { BalldontlieClient, BdlTeam } from './balldontlie.client';

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
