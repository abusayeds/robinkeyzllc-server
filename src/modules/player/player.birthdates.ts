import { headerKey, parseCsv } from '../../utils/csv';

export type BirthdateRow = {
  /** The header is line 1, so the first row of data is line 2. */
  lineNumber: number;
  player: string;
  rawBirthdate: string;
  /** Midnight UTC on the stated day, or null when the cell could not be read. */
  birthdate: Date | null;
  /**
   * Years of service, where the file carries a column for it. Optional, and
   * separate from the birthdate: a file may correct either, both, or carry
   * only the column it has.
   */
  rawExperience: string;
  experience: number | null;
  issue: string | null;
};

export type ReadBirthdateFileResult = {
  rows: BirthdateRow[];
  /** Problems with the file as a whole, not with any one row. */
  fileIssues: string[];
  /** Headers we did not recognise. Flagged, then ignored, never imported. */
  ignoredColumns: string[];
};

/** Both spellings of each column, because a spreadsheet is typed by hand. */
const PLAYER_HEADERS = ['player', 'player_name', 'name'];
const BIRTHDATE_HEADERS = ['birthdate', 'birth_date', 'dob', 'date_of_birth'];
const EXPERIENCE_HEADERS = [
  'experience',
  'exp',
  'years_of_service',
  'service_years',
  'yos',
];

/** Nobody has played more than about 23 seasons; 30 is room to spare. */
const MAX_EXPERIENCE = 30;

/** Nobody playing today was born before this, and nobody is born later than today. */
const EARLIEST_YEAR = 1900;

/**
 * Reads one birthdate cell, which must be ISO.
 *
 * `3/15/2001` is refused rather than guessed at: a spreadsheet writes both
 * day-first and month-first, the two are indistinguishable below the 13th, and
 * a silently swapped birthdate is never noticed. The message says what to do.
 */
export function parseBirthdate(raw: string | null | undefined): {
  birthdate: Date | null;
  issue: string | null;
} {
  const cleaned = (raw ?? '').trim();
  if (!cleaned) {
    return { birthdate: null, issue: 'Birthdate is required.' };
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
  if (!match) {
    return {
      birthdate: null,
      issue: `"${cleaned}" is not written as YYYY-MM-DD. Format the column as text in your spreadsheet so it is not rewritten.`,
    };
  }

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);

  const date = new Date(Date.UTC(year, month - 1, day));

  // Date.UTC rolls 2001-02-30 forward into March rather than failing, so the
  // parts are compared back to catch a day that does not exist.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { birthdate: null, issue: `There is no such date as ${cleaned}.` };
  }

  if (year < EARLIEST_YEAR) {
    return { birthdate: null, issue: `${cleaned} is too long ago to be real.` };
  }
  if (date.getTime() > Date.now()) {
    return { birthdate: null, issue: `${cleaned} is in the future.` };
  }

  return { birthdate: date, issue: null };
}

/**
 * Reads one experience cell.
 *
 * Blank is a real answer and not an error: a file may carry the column for
 * some players and leave it empty for the rest, and a row with a birthdate
 * and no experience is still worth importing.
 */
export function parseExperience(raw: string | null | undefined): {
  experience: number | null;
  issue: string | null;
} {
  const cleaned = (raw ?? '').trim();
  if (!cleaned) return { experience: null, issue: null };

  if (!/^\d{1,2}$/.test(cleaned)) {
    return {
      experience: null,
      issue: `"${cleaned}" is not a whole number of seasons.`,
    };
  }

  const value = Number(cleaned);
  if (value > MAX_EXPERIENCE) {
    return {
      experience: null,
      issue: `${cleaned} seasons is more than anyone has played.`,
    };
  }

  return { experience: value, issue: null };
}

/**
 * Reads the birthdate file.
 *
 * Deliberately separate from the roster import: this one is global, a Super
 * Admin loads it once for every player in the platform, and it carries no
 * league, no team and no money.
 */
export function readBirthdateFile(text: string): ReadBirthdateFileResult {
  const grid = parseCsv(text);
  const fileIssues: string[] = [];
  const ignoredColumns: string[] = [];

  if (grid.length === 0) {
    return { rows: [], fileIssues: ['The file is empty.'], ignoredColumns };
  }

  let playerAt: number | null = null;
  let birthdateAt: number | null = null;
  let experienceAt: number | null = null;

  grid[0].forEach((raw, index) => {
    const key = headerKey(raw);
    if (!key) return;

    if (PLAYER_HEADERS.includes(key)) {
      if (playerAt !== null) {
        fileIssues.push('The player column appears more than once.');
        return;
      }
      playerAt = index;
      return;
    }
    if (BIRTHDATE_HEADERS.includes(key)) {
      if (birthdateAt !== null) {
        fileIssues.push('The birthdate column appears more than once.');
        return;
      }
      birthdateAt = index;
      return;
    }
    if (EXPERIENCE_HEADERS.includes(key)) {
      if (experienceAt !== null) {
        fileIssues.push('The experience column appears more than once.');
        return;
      }
      experienceAt = index;
      return;
    }

    ignoredColumns.push(raw.trim());
  });

  if (playerAt === null) fileIssues.push('The "player" column is missing.');
  // Either column on its own is a usable file: one that only carries
  // experience is the whole point of allowing it here.
  if (birthdateAt === null && experienceAt === null) {
    fileIssues.push(
      'The file needs a "birthdate" column, an "experience" column, or both.',
    );
  }

  if (fileIssues.length > 0 || playerAt === null) {
    return { rows: [], fileIssues, ignoredColumns };
  }

  const playerIndex: number = playerAt;
  const birthdateIndex: number | null = birthdateAt;
  const experienceIndex: number | null = experienceAt;

  const rows = grid.slice(1).map((line, offset) => {
    const player = (line[playerIndex] ?? '').trim();

    const rawBirthdate =
      birthdateIndex === null ? '' : (line[birthdateIndex] ?? '').trim();
    const rawExperience =
      experienceIndex === null ? '' : (line[experienceIndex] ?? '').trim();

    // A blank birthdate is only a problem in a file that has the column and
    // nothing else to offer for that row.
    const date =
      birthdateIndex === null
        ? { birthdate: null, issue: null }
        : rawBirthdate === '' && rawExperience !== ''
          ? { birthdate: null, issue: null }
          : parseBirthdate(rawBirthdate);

    const years = parseExperience(rawExperience);

    const empty =
      date.birthdate === null &&
      years.experience === null &&
      date.issue === null &&
      years.issue === null;

    return {
      lineNumber: offset + 2,
      player,
      rawBirthdate,
      birthdate: date.birthdate,
      rawExperience,
      experience: years.experience,
      issue: !player
        ? 'Player is required.'
        : (date.issue ??
          years.issue ??
          (empty
            ? 'This row gives neither a birthdate nor experience.'
            : null)),
    } satisfies BirthdateRow;
  });

  return { rows, fileIssues, ignoredColumns };
}
