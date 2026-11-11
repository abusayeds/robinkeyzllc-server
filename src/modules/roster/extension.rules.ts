import { EffectiveCap } from '../cap/cap.service';

/**
 * Rules 10.2 to 10.8 — what an extension may be worth and how long it may run.
 *
 * Kept as plain functions, like `trade.rules.ts` and `draft.rules.ts`: the
 * arithmetic is the rule book, it needs no database, and the preview and the
 * write both have to get exactly the same answer from it.
 *
 * **One thing here is deliberately missing.** Rules 10.7 and 10.8 say the
 * starting salary is "set from the owner's ranking input", and Appendix B item
 * 7 says those detailed rules are *still to be defined*. So this file works
 * out the **ceiling** the rule book does define and lets the owner name a
 * figure under it. When the ranking rules arrive they decide the number inside
 * that ceiling; nothing here has to change to make room for them.
 */

export type ExtensionKind = 'veteran' | 'rookieScale';

export type BirdRights = 'full' | 'early' | 'none';

/** Rule 10.2 — by years of service, or 105% of his prior salary if higher. */
export function maximumSalary(
  cap: EffectiveCap,
  yearsOfService: number | null,
  priorSalary: number,
): number {
  const years = yearsOfService ?? 0;

  const byService =
    years >= 10
      ? cap.maxSalary10Plus
      : years >= 7
        ? cap.maxSalary7to9
        : cap.maxSalary0to6;

  return Math.max(byService, Math.round(priorSalary * 1.05));
}

/**
 * Rule 10.5 — each year may rise by up to 8% of the first-year salary with
 * Full or Early Bird rights, and 5% otherwise.
 *
 * Of the *first-year* salary, not compounding on the year before: the raise is
 * a flat step, which is why this returns an amount rather than a rate.
 */
export function raiseStep(firstYear: number, bird: BirdRights): number {
  const pct = bird === 'none' ? 5 : 8;
  return Math.round((firstYear * pct) / 100);
}

/** Rule 10.4 — five years re-signing with Full Bird, four otherwise. */
export function maxLengthFor(kind: ExtensionKind, bird: BirdRights): number {
  // Rule 10.8 allows a rookie-scale extension up to five years whatever his
  // bird rights are, because he has only ever been on one contract.
  if (kind === 'rookieScale') return 5;

  // Rule 10.7 caps a veteran extension at four new seasons, which is the
  // tighter of the two limits even for a Full Bird player.
  return bird === 'full' ? 4 : 4;
}

export type ExtensionLimits = {
  kind: ExtensionKind;
  bird: BirdRights;
  /** The salary the current deal pays in its final season. */
  priorSalary: number;
  /** Rule 10.2, which caps everything below it. */
  maximumSalary: number;
  /** Rules 10.7 / 10.8 — the most the first new season may pay. */
  maxFirstYear: number;
  /** How the ceiling was arrived at, so the screen can say why. */
  maxFirstYearBasis: string;
  maxSeasons: number;
  /** Rule 10.5, as an amount rather than a rate. */
  raiseStep: number;
  /** The first season the extension pays, which is the one after the deal ends. */
  firstSeasonStartYear: number;
};

export function extensionLimits(input: {
  kind: ExtensionKind;
  cap: EffectiveCap;
  bird: BirdRights;
  priorSalary: number;
  yearsOfService: number | null;
  /** Appendix B item 6 — the commissioner marks who may reach 30% or 35%. */
  supermaxEligible: boolean;
  rookieMax30Eligible: boolean;
  endSeasonStartYear: number;
}): ExtensionLimits {
  const { kind, cap, bird, priorSalary } = input;

  const maximum = input.supermaxEligible
    ? // Rule 10.3 — 35% of the cap, when the commissioner has marked him.
      cap.maxSalary10Plus
    : maximumSalary(cap, input.yearsOfService, priorSalary);

  let maxFirstYear: number;
  let basis: string;

  if (kind === 'rookieScale') {
    // Rule 10.8 — 25% of the cap, or 30% when marked eligible.
    const ceiling = input.rookieMax30Eligible
      ? cap.maxSalary7to9
      : cap.maxSalary0to6;
    maxFirstYear = Math.min(ceiling, maximum);
    basis = input.rookieMax30Eligible
      ? 'Rule 10.8 — 30% of the cap, commissioner approved'
      : 'Rule 10.8 — 25% of the cap';
  } else {
    // Rule 10.7 — 140% of his current salary, capped at the maximum.
    const ceiling = Math.round(priorSalary * 1.4);
    maxFirstYear = Math.min(ceiling, maximum);
    basis =
      ceiling <= maximum
        ? 'Rule 10.7 — 140% of his current salary'
        : 'Rule 10.2 — his maximum salary';
  }

  return {
    kind,
    bird,
    priorSalary,
    maximumSalary: maximum,
    maxFirstYear,
    maxFirstYearBasis: basis,
    maxSeasons: maxLengthFor(kind, bird),
    raiseStep: raiseStep(maxFirstYear, bird),
    firstSeasonStartYear: input.endSeasonStartYear + 1,
  };
}

export type ExtensionYearInput = {
  seasonStartYear: number;
  salary: number;
  /** Rule 10.6 — player or team option, and only on the final year. */
  optionType: 'player' | 'team' | null;
};

/** Every reason an offer is refused, in the order the screen lists them. */
export function extensionProblems(
  years: ExtensionYearInput[],
  limits: ExtensionLimits,
): string[] {
  const problems: string[] = [];

  if (years.length === 0) {
    return ['An extension needs at least one season.'];
  }

  if (years.length > limits.maxSeasons) {
    problems.push(
      `Rule 10.4 allows at most ${limits.maxSeasons} new season${
        limits.maxSeasons === 1 ? '' : 's'
      } here.`,
    );
  }

  const sorted = [...years].sort(
    (a, b) => a.seasonStartYear - b.seasonStartYear,
  );

  if (sorted[0].seasonStartYear !== limits.firstSeasonStartYear) {
    problems.push(
      `An extension starts the season after the current deal ends, which is ${limits.firstSeasonStartYear}.`,
    );
  }

  // Consecutive seasons, with no gaps: a contract cannot skip a year.
  for (let index = 1; index < sorted.length; index += 1) {
    if (
      sorted[index].seasonStartYear !==
      sorted[index - 1].seasonStartYear + 1
    ) {
      problems.push('The seasons of an extension have to run consecutively.');
      break;
    }
  }

  const first = sorted[0].salary;

  if (first > limits.maxFirstYear) {
    problems.push(
      `The first season may not exceed ${limits.maxFirstYear.toLocaleString('en-US')} (${limits.maxFirstYearBasis}).`,
    );
  }

  if (first <= 0) {
    problems.push('The first season needs a salary.');
  }

  // Rule 10.5 — each later year may differ from the one before it by at most
  // the step, in either direction: a decline is as limited as a raise.
  const step = raiseStep(first, limits.bird);
  for (let index = 1; index < sorted.length; index += 1) {
    const change = Math.abs(sorted[index].salary - sorted[index - 1].salary);
    // A dollar of slack, because the step is rounded to whole dollars and an
    // evenly divided total can land one off it.
    if (change > step + 1) {
      problems.push(
        `Rule 10.5 limits each year's change to ${step.toLocaleString('en-US')} with ${
          limits.bird === 'none' ? 'Non-Bird' : 'Bird'
        } rights.`,
      );
      break;
    }
  }

  if (sorted.some((year) => year.salary > limits.maximumSalary)) {
    problems.push(
      `No season may exceed his maximum of ${limits.maximumSalary.toLocaleString('en-US')} (Rule 10.2).`,
    );
  }

  // Rule 10.6 — options live on the final year only.
  const optionOnEarlierYear = sorted
    .slice(0, -1)
    .some((year) => year.optionType !== null);
  if (optionOnEarlierYear) {
    problems.push('Rule 10.6 allows an option on the final year only.');
  }

  return problems;
}
