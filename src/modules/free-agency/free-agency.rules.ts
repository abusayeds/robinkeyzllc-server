import { ContractType, SignedVia } from '@prisma/client';

/**
 * One rule, and whether this offer satisfies it.
 *
 * Stored on the offer rather than recomputed on every read: a commissioner
 * looking into a disputed signing needs to see the state the offer was judged
 * against, not the roster as it stands today.
 */
export type OfferCheck = {
  label: string;
  pass: boolean;
  detail?: string;
};

export type OfferTerms = {
  years: number;
  firstYearSalary: number;
  raisePct: number;
  contractType: ContractType;
  signedVia: SignedVia;
};

export type OfferContext = {
  salaryCap: number;
  minPlayerSalary: number;
  maxPlayerSalary: number;
  hardCapEnabled: boolean;
  hardCapThreshold: number | null;
  /** Everything the team already owes this season, before this offer. */
  committed: number;
  rosterCount: number;
  maxRosterSize: number;
  twoWayCount: number;
  maxTwoWay: number;
  /** Whether the player is actually available to sign. */
  playerIsFree: boolean;
  /** Whether the league's calendar has free agency open today. */
  windowOpen: boolean;
};

const money = (value: number) => `$${value.toLocaleString('en-US')}`;

/**
 * Each later season adds `raisePct` of the **first** year, which is how CBA
 * raises work. Compounding would quietly inflate a long deal: 5% on $10M over
 * four years is 10 / 10.5 / 11 / 11.5, not 10 / 10.5 / 11.025 / 11.576.
 */
export function salaryForSeason(terms: OfferTerms, index: number): number {
  const raise = (terms.firstYearSalary * terms.raisePct) / 100;
  return Math.round(terms.firstYearSalary + raise * index);
}

export function offerSeasons(terms: OfferTerms, startSeasonStartYear: number) {
  return Array.from({ length: terms.years }, (_, index) => ({
    seasonStartYear: startSeasonStartYear + index,
    salary: salaryForSeason(terms, index),
  }));
}

export function offerTotalValue(terms: OfferTerms): number {
  let total = 0;
  for (let index = 0; index < terms.years; index += 1) {
    total += salaryForSeason(terms, index);
  }
  return total;
}

/**
 * Judges an offer against the league's own rules.
 *
 * Returns every rule, passed or failed, rather than the first failure. A team
 * that is both over the cap and out of roster spots should be told both at
 * once instead of discovering the second after fixing the first.
 */
export function checkOffer(
  terms: OfferTerms,
  context: OfferContext,
): OfferCheck[] {
  const checks: OfferCheck[] = [];
  const isTwoWay = terms.contractType === ContractType.twoWay;
  const firstYear = isTwoWay ? 0 : terms.firstYearSalary;

  checks.push({
    label: 'Player is a free agent',
    pass: context.playerIsFree,
    detail: context.playerIsFree
      ? undefined
      : 'This player is already under contract in this league.',
  });

  checks.push({
    label: 'Free agency is open',
    pass: context.windowOpen,
    detail: context.windowOpen
      ? undefined
      : 'The league calendar has no free agency period covering today.',
  });

  if (isTwoWay) {
    const room = context.twoWayCount < context.maxTwoWay;
    checks.push({
      label: 'Two-way slot available',
      pass: room,
      detail: room
        ? `${context.twoWayCount} of ${context.maxTwoWay} used.`
        : `All ${context.maxTwoWay} two-way slots are taken.`,
    });
  } else {
    const room = context.rosterCount < context.maxRosterSize;
    checks.push({
      label: 'Roster spot available',
      pass: room,
      detail: room
        ? `${context.rosterCount} of ${context.maxRosterSize} filled.`
        : `The roster is full at ${context.maxRosterSize}.`,
    });

    // A cap of 0 means the league has not set one. Nothing can be measured
    // against it, so the cap rules are reported as not applicable rather than
    // silently passed.
    if (context.salaryCap <= 0) {
      checks.push({
        label: 'Salary cap rules',
        pass: true,
        detail:
          'This league has no salary cap set, so nothing is checked against one.',
      });
    } else {
      const aboveMinimum = firstYear >= context.minPlayerSalary;
      checks.push({
        label: 'At or above the minimum salary',
        pass: aboveMinimum,
        detail: aboveMinimum
          ? undefined
          : `The league minimum is ${money(context.minPlayerSalary)}.`,
      });

      const underMax = firstYear <= context.maxPlayerSalary;
      checks.push({
        label: 'Within the maximum player salary',
        pass: underMax,
        detail: underMax
          ? undefined
          : `The maximum is ${money(context.maxPlayerSalary)}.`,
      });

      const room = context.salaryCap - context.committed;
      const fitsUnderCap = firstYear <= room;
      const usesException = terms.signedVia !== SignedVia.capSpace;

      checks.push({
        label: usesException
          ? 'Signed with an exception'
          : 'Team has cap space',
        // An exception is what lets a team over the cap sign anyone at all, so
        // naming one answers this rule instead of failing it.
        pass: fitsUnderCap || usesException,
        detail: fitsUnderCap
          ? `${money(room)} of room.`
          : usesException
            ? 'Over the cap, but signed using an exception.'
            : `${money(firstYear)} offered against ${money(room)} of room.`,
      });

      if (context.hardCapEnabled && context.hardCapThreshold !== null) {
        const after = context.committed + firstYear;
        const underHardCap = after <= context.hardCapThreshold;
        checks.push({
          label: 'Stays under the hard cap',
          pass: underHardCap,
          detail: underHardCap
            ? `${money(context.hardCapThreshold - after)} below it.`
            : `${money(after - context.hardCapThreshold)} over the ${money(context.hardCapThreshold)} hard cap.`,
        });
      }
    }
  }

  return checks;
}

export const offerIsLegal = (checks: OfferCheck[]) =>
  checks.every((check) => check.pass);

/**
 * Bird rights follow from the years a player has spent with the same team.
 * Three qualifies for full rights, two for early, anything less for none —
 * and a league may let bird years run past three, so this is a floor test.
 */
export function birdRightsOf(birdYears: number): 'full' | 'early' | 'none' {
  if (birdYears >= 3) return 'full';
  if (birdYears === 2) return 'early';
  return 'none';
}
