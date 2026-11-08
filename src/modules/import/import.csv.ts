import { headerKey, parseCsv } from '../../utils/csv';
import { parseSeasonLabel, RawRow, seasonLabel } from './import.rows';

export type ReadFileResult = {
  rows: RawRow[];
  /** Season start years, in file order. */
  seasons: number[];
  /** Problems with the file as a whole, not with any one row. */
  fileIssues: string[];
  /** Headers we did not recognise. Flagged, then ignored, never imported. */
  ignoredColumns: string[];
};

const FIXED_COLUMNS = [
  'team',
  'player',
  'bird_years',
  'contract_type',
  'signed_via',
  'signed_season',
] as const;

type FixedColumn = (typeof FIXED_COLUMNS)[number];

/**
 * Turns the parsed grid into rows the classifier can read, and says what is
 * wrong with the file itself.
 *
 * Column order does not matter and capitals do not matter, but a column we do
 * not know is reported rather than quietly dropped — the commissioner needs to
 * find out here, not when a contract is missing.
 */
export function readImportFile(text: string): ReadFileResult {
  const grid = parseCsv(text);
  const fileIssues: string[] = [];
  const ignoredColumns: string[] = [];

  if (grid.length === 0) {
    return {
      rows: [],
      seasons: [],
      fileIssues: ['The file is empty.'],
      ignoredColumns,
    };
  }

  const header = grid[0];
  const fixedAt = new Map<FixedColumn, number>();
  const seasonAt = new Map<number, number>();

  header.forEach((raw, index) => {
    const key = headerKey(raw);
    if (!key) return;

    if ((FIXED_COLUMNS as readonly string[]).includes(key)) {
      const column = key as FixedColumn;
      if (fixedAt.has(column)) {
        fileIssues.push(`The column "${raw.trim()}" appears more than once.`);
        return;
      }
      fixedAt.set(column, index);
      return;
    }

    const season = parseSeasonLabel(raw);
    if (season !== null) {
      if (seasonAt.has(season)) {
        fileIssues.push(
          `The season ${seasonLabel(season)} appears more than once.`,
        );
        return;
      }
      seasonAt.set(season, index);
      return;
    }

    // A bare year is the one case worth naming, because it looks right.
    if (/^\d{4}$/.test(raw.trim())) {
      fileIssues.push(
        `"${raw.trim()}" is ambiguous — write the season as ${raw.trim()}-${String((Number(raw.trim()) + 1) % 100).padStart(2, '0')}.`,
      );
      return;
    }

    ignoredColumns.push(raw.trim());
  });

  for (const required of ['team', 'player', 'bird_years'] as const) {
    if (!fixedAt.has(required)) {
      fileIssues.push(`The "${required}" column is missing.`);
    }
  }
  if (seasonAt.size === 0) {
    fileIssues.push(
      'The file has no season columns, so there is nothing to import.',
    );
  }

  if (fileIssues.length > 0) {
    return {
      rows: [],
      seasons: [...seasonAt.keys()],
      fileIssues,
      ignoredColumns,
    };
  }

  const at = (line: string[], column: FixedColumn) => {
    const index = fixedAt.get(column);
    return index === undefined ? '' : (line[index] ?? '');
  };

  const seasons = [...seasonAt.keys()].sort((a, b) => a - b);

  const rows = grid.slice(1).map((line, offset) => {
    const cells: Record<number, string> = {};
    for (const [season, index] of seasonAt) {
      cells[season] = line[index] ?? '';
    }

    return {
      // The header is line 1, so the first row of data is line 2 — which is
      // what the commissioner sees in their spreadsheet.
      lineNumber: offset + 2,
      team: at(line, 'team'),
      player: at(line, 'player'),
      birdYears: at(line, 'bird_years'),
      contractType: at(line, 'contract_type'),
      signedVia: at(line, 'signed_via'),
      signedSeason: at(line, 'signed_season'),
      seasons: cells,
    } satisfies RawRow;
  });

  return { rows, seasons, fileIssues, ignoredColumns };
}
