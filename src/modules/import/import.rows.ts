import { ContractType, ImportRowType, SignedVia } from '@prisma/client';
import { parseSeasonLabel, seasonLabel } from '../../utils/season';
import { ParsedCell, parseSalaryCell } from './import.cells';

// Re-exported so the import module stays the one place its callers import from.
export { parseSeasonLabel, seasonLabel };

/**
 * Something the commissioner has to look at before the import can be
 * confirmed. `fix` is the one-line suggestion the preview shows underneath.
 */
export type RowIssue = {
  field: string;
  message: string;
  fix?: string;
};

export type RawRow = {
  lineNumber: number;
  team: string;
  player: string;
  birdYears: string;
  contractType: string;
  signedVia: string;
  signedSeason: string;
  /** Raw cell text, keyed by the season's starting year. */
  seasons: Record<number, string>;
};

export type ClassifiedRow = RawRow & {
  rowType: ImportRowType;
  cells: Record<number, ParsedCell>;
  parsedBirdYears: number | null;
  parsedContractType: ContractType | null;
  parsedSignedVia: SignedVia | null;
  parsedSignedSeasonStartYear: number | null;
  issues: RowIssue[];
};

/** Reduced for comparison: uppercase, no punctuation, single spaces. */
const label = (value: string) =>
  value
    .replace(/[_\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const CONTRACT_TYPES: Record<string, ContractType> = {
  STANDARD: ContractType.standard,
  'ROOKIE SCALE': ContractType.rookieScale,
  'VETERAN MINIMUM': ContractType.veteranMinimum,
  SUPERMAX: ContractType.supermax,
  'TWO WAY': ContractType.twoWay,
  TWOWAY: ContractType.twoWay,
  'NON GUARANTEED': ContractType.nonGuaranteed,
  NONGUARANTEED: ContractType.nonGuaranteed,
  'PARTIALLY GUARANTEED': ContractType.partiallyGuaranteed,
};

/**
 * What a wrong value is offered instead. The lookup tables above hold every
 * spelling that works, including ones nobody would type on purpose, so showing
 * their keys would read as nonsense.
 */
const CONTRACT_TYPE_CHOICES =
  'Standard, Rookie Scale, Veteran Minimum, Supermax, Two-Way, Non-Guaranteed, Partially Guaranteed';

const SIGNED_VIA_CHOICES =
  'Cap Space, Non-Taxpayer MLE, Taxpayer MLE, Room MLE, Bi-Annual Exception, Disabled Player Exception';

const SIGNED_VIA: Record<string, SignedVia> = {
  'CAP SPACE': SignedVia.capSpace,
  'NON TAXPAYER MLE': SignedVia.nonTaxpayerMle,
  'NONTAXPAYER MLE': SignedVia.nonTaxpayerMle,
  'TAXPAYER MLE': SignedVia.taxpayerMle,
  'ROOM MLE': SignedVia.roomMle,
  'BI ANNUAL EXCEPTION': SignedVia.biAnnualException,
  BIANNUAL: SignedVia.biAnnualException,
  'BIANNUAL EXCEPTION': SignedVia.biAnnualException,
  'DISABLED PLAYER EXCEPTION': SignedVia.disabledPlayerException,
};

/** One row, read and checked on its own. Cross-row rules come later. */
export function classifyRow(row: RawRow): ClassifiedRow {
  const issues: RowIssue[] = [];
  const cells: Record<number, ParsedCell> = {};

  let salaryCount = 0;
  let capHoldCount = 0;
  let deadMoneyCount = 0;
  let invalidCount = 0;

  for (const [season, raw] of Object.entries(row.seasons)) {
    const year = Number(season);
    const cell = parseSalaryCell(raw);
    cells[year] = cell;

    if (cell.kind === 'invalid') {
      issues.push({
        field: seasonLabel(year),
        message: cell.reason,
        fix: 'Write the amount first, then a space, then the tag — for example "4000000 TO".',
      });
      invalidCount += 1;
      continue;
    }
    if (cell.kind === 'salary') salaryCount += 1;
    if (cell.kind === 'capHold') capHoldCount += 1;
    if (cell.kind === 'deadMoney') deadMoneyCount += 1;
  }

  let rowType: ImportRowType = ImportRowType.unknown;
  if (salaryCount > 0) rowType = ImportRowType.contract;
  else if (deadMoneyCount > 0) rowType = ImportRowType.deadCap;
  else if (capHoldCount > 0) rowType = ImportRowType.rights;

  if (salaryCount > 0 && deadMoneyCount > 0) {
    issues.push({
      field: 'seasons',
      message:
        'This row mixes salaries with dead cap, which belong to two different teams.',
      fix: 'Split it into two rows: the contract on the new team, the dead cap on the team that waived him.',
    });
  }

  if (deadMoneyCount > 0 && capHoldCount > 0) {
    issues.push({
      field: 'seasons',
      message: 'This row mixes dead cap with a cap hold.',
      fix: 'Split it into two rows.',
    });
  }

  // Only worth saying when nothing could be read at all. If a cell was already
  // reported as unreadable, this would just be the same problem a second time.
  if (rowType === ImportRowType.unknown && invalidCount === 0) {
    issues.push({
      field: 'seasons',
      message:
        'No season on this row has a salary, a cap hold or a dead cap amount.',
      fix: 'Fill in at least one season column.',
    });
  }

  if (!row.team.trim()) {
    issues.push({ field: 'team', message: 'Team is required.' });
  }
  if (!row.player.trim()) {
    issues.push({ field: 'player', message: 'Player is required.' });
  }

  // Bird years are ignored on a dead cap row: the player is no longer there to
  // accumulate them.
  let parsedBirdYears: number | null = null;
  if (rowType !== ImportRowType.deadCap) {
    const raw = row.birdYears.trim();
    if (!raw) {
      issues.push({ field: 'bird_years', message: 'Bird years are required.' });
    } else if (!/^\d+$/.test(raw)) {
      issues.push({
        field: 'bird_years',
        message: `"${raw}" is not a whole number.`,
        fix: 'Use 0 or more. There is no upper limit.',
      });
    } else {
      parsedBirdYears = Number(raw);
    }
  }

  const parsedContractType = readLabel(
    row.contractType,
    CONTRACT_TYPES,
    ContractType.standard,
    'contract_type',
    CONTRACT_TYPE_CHOICES,
    issues,
  );

  const parsedSignedVia = readLabel(
    row.signedVia,
    SIGNED_VIA,
    SignedVia.capSpace,
    'signed_via',
    SIGNED_VIA_CHOICES,
    issues,
  );

  let parsedSignedSeasonStartYear: number | null = null;
  if (row.signedSeason.trim()) {
    parsedSignedSeasonStartYear = parseSeasonLabel(row.signedSeason);
    if (parsedSignedSeasonStartYear === null) {
      issues.push({
        field: 'signed_season',
        message: `"${row.signedSeason.trim()}" is not a season we can read.`,
        fix: 'Write it as 2026-27. A bare year is ambiguous.',
      });
    }
  }

  // A two-way contract is a marker plus zeros, never the words "Two-Way" in a
  // salary cell — the client was explicit about this.
  if (parsedContractType === ContractType.twoWay) {
    const paid = Object.values(cells).some(
      (cell) => cell.kind === 'salary' && cell.amount !== 0,
    );
    if (paid) {
      issues.push({
        field: 'seasons',
        message: 'A two-way contract carries no salary.',
        fix: 'Put 0 in each season column.',
      });
    }
  }

  return {
    ...row,
    rowType,
    cells,
    parsedBirdYears,
    parsedContractType,
    parsedSignedVia,
    parsedSignedSeasonStartYear,
    issues,
  };
}

/**
 * Rules that only show up once the whole file is in view: the same player
 * twice, or two teams both claiming him.
 *
 * Returns extra issues keyed by line number, so a caller can merge them into
 * the rows it already has rather than re-walking them.
 */
export function findCrossRowIssues(
  rows: Array<ClassifiedRow & { playerId: number | null }>,
): Map<number, RowIssue[]> {
  const extra = new Map<number, RowIssue[]>();
  const add = (lineNumber: number, issue: RowIssue) => {
    const list = extra.get(lineNumber) ?? [];
    list.push(issue);
    extra.set(lineNumber, list);
  };

  const byPlayer = new Map<
    number,
    Array<ClassifiedRow & { playerId: number | null }>
  >();
  for (const row of rows) {
    if (row.playerId === null) continue;
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }

  for (const [, group] of byPlayer) {
    const contracts = group.filter((r) => r.rowType === ImportRowType.contract);
    const rights = group.filter((r) => r.rowType === ImportRowType.rights);

    if (contracts.length > 1) {
      const lines = contracts.map((r) => r.lineNumber).join(', ');
      for (const row of contracts) {
        add(row.lineNumber, {
          field: 'player',
          message: `${row.player.trim()} has a contract on more than one row (lines ${lines}).`,
          fix: 'A player can only be under contract to one team. Remove the rows that do not belong.',
        });
      }
    }

    // A dead cap row alongside a contract row is expected and allowed: it is
    // the team that waived him and the team that signed him. Rights are
    // different — nobody can hold his rights while somebody else has him.
    for (const held of rights) {
      for (const signed of contracts) {
        if (
          held.team.trim().toUpperCase() === signed.team.trim().toUpperCase()
        ) {
          continue;
        }
        add(held.lineNumber, {
          field: 'team',
          message: `${held.player.trim()} is held by ${held.team.trim()} on this row but under contract to ${signed.team.trim()} on line ${signed.lineNumber}.`,
          fix: 'Remove whichever row is out of date.',
        });
      }
    }
  }

  // Two dead cap amounts for the same team, player and season cannot both be
  // right, and the database would refuse the second one anyway.
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (row.rowType !== ImportRowType.deadCap || row.playerId === null)
      continue;

    for (const [season, cell] of Object.entries(row.cells)) {
      if (cell.kind !== 'deadMoney') continue;
      const key = `${row.team.trim().toUpperCase()}|${row.playerId}|${season}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, row.lineNumber);
        continue;
      }
      add(row.lineNumber, {
        field: seasonLabel(Number(season)),
        message: `${row.team.trim()} already has dead cap for ${row.player.trim()} in ${seasonLabel(Number(season))} on line ${first}.`,
        fix: 'Combine them into one row.',
      });
    }
  }

  return extra;
}

function readLabel<T>(
  raw: string,
  table: Record<string, T>,
  fallback: T,
  field: string,
  choices: string,
  issues: RowIssue[],
): T | null {
  const value = raw.trim();
  if (!value) return fallback;

  const hit = table[label(value)];
  if (hit !== undefined) return hit;

  issues.push({
    field,
    message: `"${value}" is not one of the values this column accepts.`,
    fix: `Use one of: ${choices}.`,
  });
  return null;
}

/** The same lookup the row classifier uses, for callers that have only a cell. */
export function readContractType(raw: string | null | undefined): ContractType {
  if (!raw?.trim()) return ContractType.standard;
  return CONTRACT_TYPES[label(raw)] ?? ContractType.standard;
}

export function readSignedVia(raw: string | null | undefined): SignedVia {
  if (!raw?.trim()) return SignedVia.capSpace;
  return SIGNED_VIA[label(raw)] ?? SignedVia.capSpace;
}
