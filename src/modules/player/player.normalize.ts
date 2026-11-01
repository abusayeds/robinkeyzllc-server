/**
 * Suffixes that carry no identity. A spreadsheet writing "Jaylen Brown Jr."
 * and the API holding "Jaylen Brown" mean the same person.
 */
const DROPPED_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/**
 * The form both sides of a name comparison are reduced to before matching.
 *
 * Accents go, because a commissioner typing "Nikola Vucevic" into a
 * spreadsheet must still find "Nikola Vučević". Periods and apostrophes go for
 * the same reason, and generational suffixes go because they are written
 * inconsistently.
 *
 * Hyphens become a space rather than disappearing: "Gilgeous-Alexander" and
 * "Gilgeous Alexander" then reduce to the same string, which removing the
 * hyphen outright would not achieve.
 */
export function normalizePlayerName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/[-–—_]/g, ' ')
    .split(/\s+/)
    .filter((part) => part.length > 0 && !DROPPED_SUFFIXES.has(part))
    .join(' ');
}
