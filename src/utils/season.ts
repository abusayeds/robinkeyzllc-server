/**
 * A season is held as the year it starts in — 2026 means the 2026-27 league
 * year. One integer sorts, subtracts for a rollover, and cannot be written two
 * ways; these two functions are the only places the display form exists.
 */

export function seasonLabel(startYear: number): string {
  const end = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${end}`;
}

/**
 * Reads "2026-27" or "2026/27". A bare "2027" is refused rather than assumed:
 * it could be either end of the span, and guessing would move a contract by a
 * year without anyone noticing.
 */
export function parseSeasonLabel(value: string): number | null {
  const cleaned = value.trim().replace(/[\u2013\u2014]/g, '-');
  const span = /^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/.exec(cleaned);
  if (!span) return null;

  const start = Number(span[1]);
  const endRaw = span[2];
  const end =
    endRaw.length === 2
      ? Math.floor(start / 100) * 100 + Number(endRaw)
      : Number(endRaw);

  // The second half of a league year is always the year after the first.
  // "2026-28" is a typo, not a two-year season.
  if (end - start !== 1) return null;
  return start;
}
