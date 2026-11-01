import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ContractSource,
  ContractType,
  GuaranteeType,
  ImportBatchStatus,
  ImportRowType,
  LeaguePlayerStatus,
  NameMatchStatus,
  Prisma,
  RosterSlotType,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { PlayerService } from '../player/player.service';
import { ParsedCell, parseSalaryCell } from './import.cells';
import { readImportFile } from './import.csv';
import {
  ClassifiedRow,
  classifyRow,
  findCrossRowIssues,
  parseSeasonLabel,
  readContractType,
  readSignedVia,
  RowIssue,
  seasonLabel,
} from './import.rows';

/** How many future seasons the generated template offers, per the client's example. */
const TEMPLATE_SEASONS = 6;

type ResolvedRow = ClassifiedRow & {
  playerId: number | null;
  teamId: number | null;
  matchStatus: NameMatchStatus;
  matchMethod: ReturnType<typeof String> | null;
  matchConfidence: number | null;
  candidates: unknown[];
};

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playerService: PlayerService,
  ) {}

  /**
   * Reads an uploaded file and stores it as a preview. Nothing reaches a
   * roster here: the commissioner has to confirm, and cannot until every row
   * is matched and every issue is gone.
   *
   * A league keeps one preview at a time. Uploading again replaces it, which
   * is what the client means by "re-upload any time before the deadline".
   */
  async preview(
    leagueId: number,
    userId: number,
    filename: string,
    text: string,
  ) {
    const file = readImportFile(text);
    if (file.fileIssues.length > 0) {
      throw new AppError(HttpStatus.BAD_REQUEST, file.fileIssues.join(' '));
    }

    const classified = file.rows.map(classifyRow);
    const resolved = await this.resolveRows(leagueId, classified);

    const crossRow = findCrossRowIssues(resolved);
    const rows = resolved.map((row) => ({
      ...row,
      issues: [...row.issues, ...(crossRow.get(row.lineNumber) ?? [])],
    }));

    const seasonStartYear = file.seasons[0];

    const batch = await this.prisma.$transaction(async (tx) => {
      // One preview per league. The old rows go with it, by cascade.
      await tx.importBatch.deleteMany({
        where: { leagueId, status: ImportBatchStatus.preview },
      });

      return tx.importBatch.create({
        data: {
          leagueId,
          uploadedById: userId,
          filename,
          seasonStartYear,
          rowCount: rows.length,
          matchedCount: rows.filter(
            (r) => r.matchStatus === NameMatchStatus.matched,
          ).length,
          issueCount: rows.reduce((total, r) => total + r.issues.length, 0),
          rows: {
            create: rows.map((row) => ({
              lineNumber: row.lineNumber,
              rawTeam: row.team,
              rawPlayer: row.player,
              rawBirdYears: row.birdYears || null,
              rawContractType: row.contractType || null,
              rawSignedVia: row.signedVia || null,
              rawSignedSeason: row.signedSeason || null,
              rawSeasons: row.seasons as Prisma.InputJsonValue,
              rowType: row.rowType,
              matchStatus: row.matchStatus,
              matchMethod: row.matchMethod as never,
              matchConfidence: row.matchConfidence,
              playerId: row.playerId,
              teamId: row.teamId,
              issues: {
                list: row.issues,
                candidates: row.candidates,
              } as unknown as Prisma.InputJsonValue,
            })),
          },
        },
        select: { id: true },
      });
    });

    return this.getPreview(leagueId, batch.id, file.ignoredColumns);
  }

  async getPreview(
    leagueId: number,
    batchId: number,
    ignoredColumns: string[] = [],
  ) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, leagueId },
      include: {
        rows: { orderBy: { lineNumber: 'asc' } },
        uploadedBy: { select: { id: true, name: true } },
      },
    });
    if (!batch) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Import not found');
    }

    const blocking = batch.rows.filter(
      (row) =>
        row.matchStatus !== NameMatchStatus.matched ||
        this.issuesOf(row.issues).length > 0,
    ).length;

    return {
      ...batch,
      ignoredColumns,
      // The one number the Confirm button is gated on.
      readyToConfirm: blocking === 0 && batch.rows.length > 0,
      blockingRowCount: blocking,
    };
  }

  async currentPreview(leagueId: number) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { leagueId, status: ImportBatchStatus.preview },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return batch ? this.getPreview(leagueId, batch.id) : null;
  }

  /**
   * The commissioner says who a row really meant. The answer is stored as an
   * alias, so the same spelling matches by itself next time.
   */
  async resolveRow(
    leagueId: number,
    batchId: number,
    rowId: number,
    playerId: number,
    userId: number,
  ) {
    const row = await this.prisma.importRow.findFirst({
      where: { id: rowId, batchId, batch: { leagueId } },
    });
    if (!row) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Import row not found');
    }

    await this.playerService.rememberAlias(playerId, row.rawPlayer, userId);

    await this.prisma.importRow.update({
      where: { id: rowId },
      data: {
        playerId,
        matchStatus: NameMatchStatus.matched,
        matchMethod: null,
        matchConfidence: 1,
      },
    });

    await this.recount(batchId);
    return this.getPreview(leagueId, batchId);
  }

  async cancel(leagueId: number, batchId: number) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, leagueId, status: ImportBatchStatus.preview },
      select: { id: true },
    });
    if (!batch) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Import not found');
    }
    await this.prisma.importBatch.delete({ where: { id: batch.id } });
  }

  /**
   * Writes the preview into the league.
   *
   * A confirmed import **replaces** whatever the league held before, which is
   * what the client specified: re-importing is how a commissioner corrects a
   * file, and leaving the old rows behind would double every roster.
   */
  async confirm(leagueId: number, batchId: number) {
    const preview = await this.getPreview(leagueId, batchId);
    if (preview.status !== ImportBatchStatus.preview) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This import has already been confirmed.',
      );
    }
    if (!preview.readyToConfirm) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${preview.blockingRowCount} row(s) still need attention before this import can be confirmed.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Order matters only for readability: every one of these cascades from
      // the league anyway.
      await tx.capHold.deleteMany({ where: { leagueId } });
      await tx.deadMoney.deleteMany({ where: { leagueId } });
      await tx.contract.deleteMany({ where: { leagueId } });
      await tx.leaguePlayer.deleteMany({ where: { leagueId } });

      for (const row of preview.rows) {
        const seasons = row.rawSeasons as Record<string, string>;
        const cells = this.cellsOf(seasons);

        if (row.rowType === ImportRowType.deadCap) {
          for (const [year, cell] of cells) {
            if (cell.kind !== 'deadMoney') continue;
            await tx.deadMoney.create({
              data: {
                leagueId,
                teamId: row.teamId!,
                playerId: row.playerId!,
                seasonStartYear: year,
                amount: cell.amount,
                isStretched: cell.isStretched,
              },
            });
          }
          continue;
        }

        const contractType = this.contractTypeOf(row.rawContractType);
        const isTwoWay = contractType === ContractType.twoWay;

        const leaguePlayer = await tx.leaguePlayer.create({
          data: {
            leagueId,
            playerId: row.playerId!,
            teamId: row.teamId,
            status:
              row.rowType === ImportRowType.rights
                ? LeaguePlayerStatus.rightsHeld
                : LeaguePlayerStatus.rostered,
            birdYears: Number(row.rawBirdYears ?? 0) || 0,
            slotType: isTwoWay
              ? RosterSlotType.twoWay
              : RosterSlotType.standard,
          },
          select: { id: true },
        });

        const salaryYears = [...cells].filter(
          ([, cell]) => cell.kind === 'salary',
        );
        const holdYears = [...cells].filter(
          ([, cell]) => cell.kind === 'capHold',
        );

        if (salaryYears.length > 0) {
          const years = salaryYears.map(([year]) => year);
          await tx.contract.create({
            data: {
              leagueId,
              leaguePlayerId: leaguePlayer.id,
              teamId: row.teamId!,
              contractType,
              signedVia: this.signedViaOf(row.rawSignedVia),
              source: ContractSource.import,
              signedSeasonStartYear: this.seasonOf(row.rawSignedSeason),
              startSeasonStartYear: Math.min(...years),
              endSeasonStartYear: Math.max(...years),
              // A qualifying offer anywhere on the row says he leaves this
              // contract as a restricted free agent.
              rfaOnExpiry: holdYears.some(
                ([, cell]) => cell.kind === 'capHold' && cell.isQualifyingOffer,
              ),
              years: {
                create: salaryYears.map(([year, cell]) => {
                  const salary = cell.kind === 'salary' ? cell : null;
                  return {
                    seasonStartYear: year,
                    salary: salary?.amount ?? 0,
                    // A two-way deal is carried at zero so it never counts
                    // against the cap.
                    capHit: isTwoWay ? 0 : (salary?.amount ?? 0),
                    optionType: salary?.optionType ?? null,
                    guaranteeType: salary?.guaranteeType ?? GuaranteeType.full,
                    guaranteedAmount: salary?.guaranteedAmount ?? null,
                  };
                }),
              },
            },
          });
        }

        for (const [year, cell] of holdYears) {
          if (cell.kind !== 'capHold') continue;
          await tx.capHold.create({
            data: {
              leagueId,
              teamId: row.teamId!,
              leaguePlayerId: leaguePlayer.id,
              seasonStartYear: year,
              // A bare CH carries no figure. Nothing calculates it yet, so it
              // is stored at zero and shown as "to be set" rather than being
              // invented here.
              amount: cell.amount ?? 0,
              isQualifyingOffer: cell.isQualifyingOffer,
            },
          });
        }
      }

      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: ImportBatchStatus.confirmed, confirmedAt: new Date() },
      });

      // The league now holds real contracts, so its setup mode is settled.
      await tx.leagueSettings.updateMany({
        where: { leagueId },
        data: { setupLocked: true },
      });
    });

    return this.getPreview(leagueId, batchId);
  }

  private async resolveRows(
    leagueId: number,
    rows: ClassifiedRow[],
  ): Promise<ResolvedRow[]> {
    const teams = await this.prisma.team.findMany({
      where: { leagueId },
      select: { id: true, name: true, abbr: true },
    });

    // Abbreviation or full name, either case — the client said both work.
    const teamByKey = new Map<string, number>();
    for (const team of teams) {
      teamByKey.set(team.abbr.trim().toUpperCase(), team.id);
      teamByKey.set(team.name.trim().toUpperCase(), team.id);
    }

    const matches = await this.playerService.matchNames(
      rows.map((row) => row.player),
    );

    return rows.map((row, index) => {
      const match = matches[index];
      const issues: RowIssue[] = [...row.issues];

      const teamId = teamByKey.get(row.team.trim().toUpperCase()) ?? null;
      if (row.team.trim() && teamId === null) {
        issues.push({
          field: 'team',
          message: `No team in this league is called "${row.team.trim()}".`,
          fix: "Use one of the league's team abbreviations, or create that team first.",
        });
      }

      if (match.status === NameMatchStatus.notFound) {
        issues.push({
          field: 'player',
          message: `No NBA player matches "${row.player.trim()}".`,
          fix: 'Search for the right player, or remove the row and re-upload.',
        });
      }
      if (match.status === NameMatchStatus.needsReview) {
        issues.push({
          field: 'player',
          message: `More than one player could be "${row.player.trim()}".`,
          fix: 'Pick the right one from the candidates.',
        });
      }

      return {
        ...row,
        issues,
        playerId: match.playerId,
        teamId,
        matchStatus: match.status,
        matchMethod: match.method,
        matchConfidence: match.confidence,
        candidates: match.candidates,
      };
    });
  }

  private async recount(batchId: number) {
    const rows = await this.prisma.importRow.findMany({
      where: { batchId },
      select: { matchStatus: true, issues: true },
    });

    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        matchedCount: rows.filter(
          (r) => r.matchStatus === NameMatchStatus.matched,
        ).length,
        issueCount: rows.reduce(
          (total, r) => total + this.issuesOf(r.issues).length,
          0,
        ),
      },
    });
  }

  private issuesOf(stored: Prisma.JsonValue): RowIssue[] {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored))
      return [];
    const list = (stored as { list?: unknown }).list;
    return Array.isArray(list) ? (list as RowIssue[]) : [];
  }

  /**
   * Cells are re-read from the raw text rather than stored alongside it. The
   * parsed form is derived, and keeping two copies invites them to disagree
   * once a commissioner edits a row.
   */
  private cellsOf(seasons: Record<string, string>) {
    const out = new Map<number, ParsedCell>();
    for (const [year, raw] of Object.entries(seasons)) {
      out.set(Number(year), parseSalaryCell(raw));
    }
    return out;
  }

  private contractTypeOf(raw: string | null) {
    return readContractType(raw);
  }

  private signedViaOf(raw: string | null) {
    return readSignedVia(raw);
  }

  private seasonOf(raw: string | null): number | null {
    return raw?.trim() ? parseSeasonLabel(raw) : null;
  }

  /** Exposed for the preview's column headers. */
  seasonLabel = seasonLabel;

  /**
   * The blank file a commissioner downloads, with this league's own season
   * columns already labelled — the client asked for the template to be
   * generated per league rather than handed out as a fixed file.
   */
  async template(leagueId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { name: true, season: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const start =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();

    const seasons = Array.from({ length: TEMPLATE_SEASONS }, (_, i) =>
      seasonLabel(start + i),
    );

    const header = [
      'team',
      'player',
      'bird_years',
      ...seasons,
      'contract_type',
      'signed_via',
      'signed_season',
    ];

    return {
      filename: `${league.name.replace(/[^\w-]+/g, '-')}-player-import.csv`,
      // Only the header. Example rows in a template get imported by accident,
      // and the client's examples are real players.
      csv: `${header.join(',')}\n`,
    };
  }
}
