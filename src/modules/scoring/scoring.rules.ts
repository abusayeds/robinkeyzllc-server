/**
 * Nine-category head-to-head scoring, as pure functions.
 *
 * `League.scoringType` is `headToHead9Cat`, and the nine are the ones the
 * standings screen names: FG%, FT%, 3PTM, PTS, REB, AST, STL, BLK, TO.
 *
 * Nothing here touches the database. A week's result has to be reproducible
 * from the totals alone, which is what makes it safe to write down once and
 * never work out again.
 */

/** The raw line. Makes and attempts, never percentages — see below. */
export type StatTotals = {
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  fg3m: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
};

export const EMPTY_TOTALS: StatTotals = {
  fgm: 0,
  fga: 0,
  ftm: 0,
  fta: 0,
  fg3m: 0,
  pts: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  turnover: 0,
};

export type CategoryKey =
  | 'fgPct'
  | 'ftPct'
  | 'threes'
  | 'pts'
  | 'reb'
  | 'ast'
  | 'stl'
  | 'blk'
  | 'to';

/**
 * The nine, in the order the screen shows them.
 *
 * `lowerBetter` is only true of turnovers, and it is the one rule that cannot
 * be inferred from the number: everywhere else more is better.
 */
export const CATEGORIES: {
  key: CategoryKey;
  label: string;
  percent: boolean;
  lowerBetter: boolean;
}[] = [
  { key: 'fgPct', label: 'FG%', percent: true, lowerBetter: false },
  { key: 'ftPct', label: 'FT%', percent: true, lowerBetter: false },
  { key: 'threes', label: '3PTM', percent: false, lowerBetter: false },
  { key: 'pts', label: 'PTS', percent: false, lowerBetter: false },
  { key: 'reb', label: 'REB', percent: false, lowerBetter: false },
  { key: 'ast', label: 'AST', percent: false, lowerBetter: false },
  { key: 'stl', label: 'STL', percent: false, lowerBetter: false },
  { key: 'blk', label: 'BLK', percent: false, lowerBetter: false },
  { key: 'to', label: 'TO', percent: false, lowerBetter: true },
];

export const CATEGORY_COUNT = CATEGORIES.length;

export function addTotals(a: StatTotals, b: StatTotals): StatTotals {
  return {
    fgm: a.fgm + b.fgm,
    fga: a.fga + b.fga,
    ftm: a.ftm + b.ftm,
    fta: a.fta + b.fta,
    fg3m: a.fg3m + b.fg3m,
    pts: a.pts + b.pts,
    reb: a.reb + b.reb,
    ast: a.ast + b.ast,
    stl: a.stl + b.stl,
    blk: a.blk + b.blk,
    turnover: a.turnover + b.turnover,
  };
}

export function sumTotals(lines: StatTotals[]): StatTotals {
  return lines.reduce(addTotals, EMPTY_TOTALS);
}

/**
 * The nine comparable values.
 *
 * A percentage is **the period's makes over the period's attempts**, worked out
 * here and nowhere else. Averaging per-game percentages gives a different
 * number — a 1-for-1 night would weigh as heavily as a 12-for-20 one — and it
 * is the commonest mistake in category scoring. Storing only makes and attempts
 * is what makes this the single place it can go wrong.
 *
 * No attempts means no percentage. 0 is returned rather than null because a
 * team that did not shoot cannot win the category, and `0 > 0` is false, which
 * is exactly the tie the comparison should find.
 */
export function categoryValues(
  totals: StatTotals,
): Record<CategoryKey, number> {
  return {
    fgPct: totals.fga > 0 ? (totals.fgm / totals.fga) * 100 : 0,
    ftPct: totals.fta > 0 ? (totals.ftm / totals.fta) * 100 : 0,
    threes: totals.fg3m,
    pts: totals.pts,
    reb: totals.reb,
    ast: totals.ast,
    stl: totals.stl,
    blk: totals.blk,
    to: totals.turnover,
  };
}

/**
 * Percentages are compared to one decimal place, which is how they are shown.
 *
 * Without this a 47.4001% beats a 47.4% and the screen shows the two as equal,
 * which reads as a bug whichever way it is explained.
 */
const PERCENT_EPSILON = 0.05;

export type CategoryResult = {
  key: CategoryKey;
  label: string;
  percent: boolean;
  home: number;
  away: number;
  /** True home won it, false away won it, null tied. */
  homeWins: boolean | null;
};

export type MatchupResult = {
  categories: CategoryResult[];
  homeCategoryWins: number;
  awayCategoryWins: number;
  tiedCategories: number;
  /** 'home', 'away', or 'tie' when the category wins are level. */
  winner: 'home' | 'away' | 'tie';
};

/** One week, two teams, nine categories. More categories takes the week. */
export function scoreMatchup(
  home: StatTotals,
  away: StatTotals,
): MatchupResult {
  const homeValues = categoryValues(home);
  const awayValues = categoryValues(away);

  const categories: CategoryResult[] = CATEGORIES.map((category) => {
    const h = homeValues[category.key];
    const a = awayValues[category.key];
    const margin = category.percent ? PERCENT_EPSILON : 0;

    let homeWins: boolean | null;
    if (Math.abs(h - a) <= margin) homeWins = null;
    else if (category.lowerBetter) homeWins = h < a;
    else homeWins = h > a;

    return {
      key: category.key,
      label: category.label,
      percent: category.percent,
      home: h,
      away: a,
      homeWins,
    };
  });

  const homeCategoryWins = categories.filter((c) => c.homeWins === true).length;
  const awayCategoryWins = categories.filter(
    (c) => c.homeWins === false,
  ).length;
  const tiedCategories = categories.filter((c) => c.homeWins === null).length;

  return {
    categories,
    homeCategoryWins,
    awayCategoryWins,
    tiedCategories,
    winner:
      homeCategoryWins > awayCategoryWins
        ? 'home'
        : awayCategoryWins > homeCategoryWins
          ? 'away'
          : 'tie',
  };
}

/**
 * The week's league-wide points — the standings screen's `WK PTS`.
 *
 * In each of the nine categories every team is ranked against every other and
 * given `teams - rank + 1` points, so the best possible week is `9 x teams`:
 * a team that wins all nine categories outright in a twelve-team league scores
 * 108. It measures a week against the whole league rather than against one
 * opponent, which is why it cannot be worked out until every team's totals are
 * in.
 *
 * Teams level in a category share the points they are between, so a two-way
 * tie for first in a twelve-team league gives each 11.5, rounded at the end.
 */
export function weeklyPoints(
  teams: { teamId: number; totals: StatTotals }[],
): Map<number, number> {
  const points = new Map<number, number>();
  for (const team of teams) points.set(team.teamId, 0);

  const count = teams.length;
  if (count === 0) return points;

  const values = new Map(
    teams.map((team) => [team.teamId, categoryValues(team.totals)]),
  );

  for (const category of CATEGORIES) {
    const ranked = [...teams]
      .map((team) => ({
        teamId: team.teamId,
        value: values.get(team.teamId)![category.key],
      }))
      .sort((a, b) =>
        category.lowerBetter ? a.value - b.value : b.value - a.value,
      );

    // Walk the sorted list in groups of equal value. Each group shares the
    // total of the places it occupies, which keeps the nine category totals
    // adding up to the same number every week however many teams tie.
    let index = 0;
    while (index < ranked.length) {
      const margin = category.percent ? PERCENT_EPSILON : 0;
      let end = index + 1;
      while (
        end < ranked.length &&
        Math.abs(ranked[end].value - ranked[index].value) <= margin
      ) {
        end += 1;
      }

      let shared = 0;
      for (let place = index; place < end; place += 1) {
        shared += count - place;
      }
      const each = shared / (end - index);

      for (let i = index; i < end; i += 1) {
        points.set(
          ranked[i].teamId,
          (points.get(ranked[i].teamId) ?? 0) + each,
        );
      }

      index = end;
    }
  }

  // Rounded once, at the end. Rounding each category instead would let the
  // nine totals drift away from `9 x teams`.
  for (const [teamId, value] of points) {
    points.set(teamId, Math.round(value));
  }

  return points;
}

export type TeamRecord = {
  wins: number;
  losses: number;
  ties: number;
  /** Categories taken all season — the standings screen's PF. */
  pointsFor: number;
  /** Categories given up all season — PA. */
  pointsAgainst: number;
  /** Most recent first, as 'W' | 'L' | 'T'. */
  results: ('W' | 'L' | 'T')[];
};

export const EMPTY_RECORD = (): TeamRecord => ({
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  pointsAgainst: 0,
  results: [],
});

/** "7-3" over the last `n` weeks, as the L10 column wants it. */
export function lastNRecord(results: ('W' | 'L' | 'T')[], n: number): string {
  const slice = results.slice(0, n);
  const wins = slice.filter((r) => r === 'W').length;
  const losses = slice.filter((r) => r === 'L').length;
  return `${wins}-${losses}`;
}

/**
 * "W4" or "L2" — how long the current run is.
 *
 * A tie ends a run without starting one, so a team that drew last week shows
 * no streak rather than a misleading one.
 */
export function streak(results: ('W' | 'L' | 'T')[]): string {
  const first = results[0];
  if (!first || first === 'T') return '—';
  let length = 0;
  for (const result of results) {
    if (result !== first) break;
    length += 1;
  }
  return `${first}${length}`;
}
