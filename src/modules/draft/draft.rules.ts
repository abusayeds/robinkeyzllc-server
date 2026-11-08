import { DraftFormat } from '@prisma/client';

/**
 * Article 12 of the AVORA CBA, as pure functions.
 *
 * Nothing here touches the database. Every rule that decides whether a pick
 * can move, or where a pick sits in an order, is worked out from values the
 * caller has already read, so each rule can be read on its own.
 */

/** The display form the pick pages use: 2026 becomes "2026-2027". */
export const draftYearLabel = (seasonStartYear: number) =>
  `${seasonStartYear}-${seasonStartYear + 1}`;

export const roundLabel = (round: number) =>
  round === 1 ? '1st Round' : round === 2 ? '2nd Round' : `Round ${round}`;

/**
 * Rule 12.1 — picks may be traded up to `windowDrafts` drafts ahead. The
 * current league year's own draft is included: it has not happened yet, and a
 * pick in it is as tradeable as any other.
 */
export function draftWindowYears(
  currentSeasonStartYear: number,
  windowDrafts: number,
): number[] {
  const years: number[] = [];
  for (let i = 0; i <= windowDrafts; i += 1) {
    years.push(currentSeasonStartYear + i);
  }
  return years;
}

export type PickShape = {
  id: number;
  seasonStartYear: number;
  round: number;
  originalTeamId: number;
  currentTeamId: number;
  protectedTopN: number | null;
  protectionOutcome: string | null;
  protectionFinalYear: number | null;
  frozenInSeason: number | null;
  usedAt: Date | null;
};

export type UntradeableReason =
  | 'used'
  | 'leagueDisabled'
  | 'frozen'
  | 'outsideWindow'
  | 'backToBack'
  | 'owedUnderProtection';

export const UNTRADEABLE_MESSAGE: Record<UntradeableReason, string> = {
  used: 'This pick has already been used in a draft.',
  leagueDisabled: 'Draft pick trading is turned off for this league.',
  frozen: 'Frozen under the Second Apron rules. It cannot be traded at all.',
  outsideWindow: "Outside the league's pick trading window.",
  backToBack:
    'Trading this would leave the team without a first-round pick in two drafts in a row.',
  owedUnderProtection:
    'Still owed to another team under a protection, rollover or conversion.',
};

/**
 * Rule 12.9 — a protected first-round pick counts as traded away in every
 * draft it could change hands in, including its rollover years. So the set of
 * years a team has given up its first is wider than the years its pick is
 * simply held by someone else.
 */
function yearsFirstRoundGivenAway(
  picks: PickShape[],
  originalTeamId: number,
): Set<number> {
  const years = new Set<number>();

  for (const pick of picks) {
    if (pick.round !== 1 || pick.originalTeamId !== originalTeamId) continue;

    const movedAway = pick.currentTeamId !== pick.originalTeamId;
    const owedUnderProtection = pick.protectedTopN !== null;
    if (!movedAway && !owedUnderProtection) continue;

    years.add(pick.seasonStartYear);

    // A rollover reaches forward: every year up to the final one is a year the
    // pick could change hands in.
    if (
      owedUnderProtection &&
      pick.protectionOutcome === 'rollover' &&
      pick.protectionFinalYear !== null
    ) {
      for (
        let year = pick.seasonStartYear + 1;
        year <= pick.protectionFinalYear;
        year += 1
      ) {
        years.add(year);
      }
    }
  }

  return years;
}

/**
 * Rule 12.11 — the reason a pick cannot be traded, or null when it can.
 *
 * `leaguePicks` must hold every pick of the league, because the back-to-back
 * rule is a question about the original team's other drafts, not about this
 * pick alone.
 */
export function untradeableReason(
  pick: PickShape,
  leaguePicks: PickShape[],
  options: {
    currentSeasonStartYear: number;
    windowDrafts: number;
    allowDraftPickTrading: boolean;
  },
): UntradeableReason | null {
  if (pick.usedAt) return 'used';
  if (!options.allowDraftPickTrading) return 'leagueDisabled';

  // Rule 12.3 — a frozen pick cannot be traded, with or without protections.
  if (pick.frozenInSeason !== null) return 'frozen';

  const lastTradeableYear =
    options.currentSeasonStartYear + options.windowDrafts;
  if (
    pick.seasonStartYear < options.currentSeasonStartYear ||
    pick.seasonStartYear > lastTradeableYear
  ) {
    return 'outsideWindow';
  }

  // Rule 12.11 — a pick that may still be owed to someone else is not the
  // current owner's to trade on.
  if (
    pick.protectedTopN !== null &&
    pick.currentTeamId === pick.originalTeamId
  ) {
    return 'owedUnderProtection';
  }

  // Rule 12.2 — no first-round picks in two consecutive future drafts. Only
  // the original team can break this, and only with a pick it still holds.
  if (pick.round === 1 && pick.currentTeamId === pick.originalTeamId) {
    const givenAway = yearsFirstRoundGivenAway(
      leaguePicks,
      pick.originalTeamId,
    );
    if (
      givenAway.has(pick.seasonStartYear - 1) ||
      givenAway.has(pick.seasonStartYear + 1)
    ) {
      return 'backToBack';
    }
  }

  return null;
}

/**
 * Rule 12.4 — the picks the commissioner has to place by hand when entering a
 * draft order. The engine cannot decide these: Rule 8.13 moves a frozen pick
 * to the end of the first round, and a protection is only resolved once the
 * order is final (Rule 12.8).
 */
export type OrderFlag = {
  pickId: number;
  seasonStartYear: number;
  round: number;
  kind: 'frozenToEndOfRound' | 'protected';
  message: string;
};

export function orderFlags(
  picks: (PickShape & { movedToEndOfRound: boolean })[],
  seasonStartYear: number,
): OrderFlag[] {
  const flags: OrderFlag[] = [];

  for (const pick of picks) {
    if (pick.seasonStartYear !== seasonStartYear || pick.usedAt) continue;

    if (pick.frozenInSeason !== null && pick.round === 1) {
      flags.push({
        pickId: pick.id,
        seasonStartYear: pick.seasonStartYear,
        round: pick.round,
        kind: 'frozenToEndOfRound',
        message: pick.movedToEndOfRound
          ? 'Frozen pick already placed at the end of the first round.'
          : 'Frozen pick: place it at the end of the first round (Rule 8.13).',
      });
    }

    if (pick.protectedTopN !== null) {
      flags.push({
        pickId: pick.id,
        seasonStartYear: pick.seasonStartYear,
        round: pick.round,
        kind: 'protected',
        message: `Top ${pick.protectedTopN} protected: where it lands decides who keeps it.`,
      });
    }
  }

  return flags;
}

/**
 * Rule 12.8 — once the order is final, a protected pick either changes hands
 * or does not, and the trade says what happens next.
 */
export type ProtectionResolution = {
  pickId: number;
  landedAt: number;
  changesHands: boolean;
  outcome: 'delivered' | 'rollover' | 'convert' | 'end' | 'unresolved';
  message: string;
};

export function resolveProtection(
  pick: PickShape,
  landedAt: number,
): ProtectionResolution {
  if (pick.protectedTopN === null) {
    return {
      pickId: pick.id,
      landedAt,
      changesHands: true,
      outcome: 'delivered',
      message: 'Unprotected: the pick changes hands.',
    };
  }

  // Rule 12.5 — it changes hands only if it falls outside the top N.
  if (landedAt > pick.protectedTopN) {
    return {
      pickId: pick.id,
      landedAt,
      changesHands: true,
      outcome: 'delivered',
      message: `Landed at ${landedAt}, outside the top ${pick.protectedTopN}: the pick changes hands.`,
    };
  }

  // Rule 12.7 — in the final year it changes hands unprotected, unless the
  // trade said the obligation ends or converts.
  if (
    pick.protectionFinalYear !== null &&
    pick.seasonStartYear >= pick.protectionFinalYear &&
    pick.protectionOutcome === 'rollover'
  ) {
    return {
      pickId: pick.id,
      landedAt,
      changesHands: true,
      outcome: 'delivered',
      message: `Final rollover year: the pick changes hands even though it landed at ${landedAt}.`,
    };
  }

  const base = `Landed at ${landedAt}, inside the top ${pick.protectedTopN}: the original team keeps it.`;

  switch (pick.protectionOutcome) {
    case 'rollover':
      return {
        pickId: pick.id,
        landedAt,
        changesHands: false,
        outcome: 'rollover',
        message: `${base} The obligation rolls over to the next draft.`,
      };
    case 'convert':
      return {
        pickId: pick.id,
        landedAt,
        changesHands: false,
        outcome: 'convert',
        message: `${base} The obligation converts to the pick named in the trade.`,
      };
    case 'end':
      return {
        pickId: pick.id,
        landedAt,
        changesHands: false,
        outcome: 'end',
        message: `${base} The obligation ends.`,
      };
    default:
      return {
        pickId: pick.id,
        landedAt,
        changesHands: false,
        outcome: 'unresolved',
        message: `${base} The trade did not say what happens next, so a commissioner has to decide.`,
      };
  }
}

/**
 * The running order of a draft.
 *
 * Snake turns the order around from `reversalRound` on, which is why the round
 * is compared against it rather than simply tested for being even: a league
 * may start the reversal at round 3 and run the first two straight.
 */
export function buildDraftOrder(
  teamIds: number[],
  options: {
    rounds: number;
    format: DraftFormat;
    reversalRound: number;
    /**
     * Rule 8.13 — seats whose first-round pick has been placed at the end of
     * that round. Only the first round moves: the penalty is on one pick, not
     * on the team's whole draft.
     */
    movedToEndOfFirstRound?: number[];
  },
): { round: number; pickInRound: number; overall: number; teamId: number }[] {
  const slots: {
    round: number;
    pickInRound: number;
    overall: number;
    teamId: number;
  }[] = [];

  const moved = new Set(options.movedToEndOfFirstRound ?? []);
  const firstRound =
    moved.size === 0
      ? teamIds
      : [
          ...teamIds.filter((id) => !moved.has(id)),
          ...teamIds.filter((id) => moved.has(id)),
        ];

  let overall = 1;
  for (let round = 1; round <= options.rounds; round += 1) {
    const reversed =
      options.format === DraftFormat.snake &&
      round >= options.reversalRound &&
      (round - options.reversalRound) % 2 === 0;

    const base = round === 1 ? firstRound : teamIds;
    const order = reversed ? [...base].reverse() : base;

    order.forEach((teamId, index) => {
      slots.push({ round, pickInRound: index + 1, overall, teamId });
      overall += 1;
    });
  }

  return slots;
}
