import type { EffectiveCap } from './cap.service';

/**
 * Article 3 — the five tiers.
 *
 * Rule 3.3: a team is in the highest tier whose threshold its Team Salary is
 * **above**, and a team exactly at a threshold is in the tier **below** it.
 * Every comparison here is therefore `>` and never `>=`.
 */
export const TIER = {
  belowCap: 'belowCap',
  overCap: 'overCap',
  luxuryTax: 'luxuryTax',
  firstApron: 'firstApron',
  secondApron: 'secondApron',
  capNotSet: 'capNotSet',
} as const;

export type Tier = (typeof TIER)[keyof typeof TIER];

/**
 * One set of names, used by every badge, validation line, cap summary and
 * page in the app. The app previously mixed "At Tax", "Luxury Tax", "Over
 * Cap, Below Tax", "1st Apron" and "First Apron" for overlapping things.
 * "First" and "Second" are spelled out; never "1st"/"2nd".
 */
export const TIER_LABEL: Record<Tier, string> = {
  belowCap: 'Under the Cap',
  overCap: 'Over the Cap',
  luxuryTax: 'Taxpayer',
  firstApron: 'First Apron',
  secondApron: 'Second Apron',
  capNotSet: 'Cap not set',
};

/**
 * Rule 3.4 — a team's tier for any transaction is its tier **after** the
 * transaction, so callers pass the figure they will end up at, not the one
 * they start from.
 */
export function tierFor(teamSalary: number, cap: EffectiveCap): Tier {
  if (!cap.isSet) return TIER.capNotSet;
  if (teamSalary > cap.secondApron) return TIER.secondApron;
  if (teamSalary > cap.firstApron) return TIER.firstApron;
  if (teamSalary > cap.luxuryTax) return TIER.luxuryTax;
  if (teamSalary > cap.salaryCap) return TIER.overCap;
  return TIER.belowCap;
}

const money = (value: number) =>
  `$${Math.round(value).toLocaleString('en-US')}`;

export type MaxIncoming = {
  limit: number;
  /** The rule that decided the limit, named the way the rule book names it. */
  ruleName: string;
  /** The arithmetic behind the limit, on one line, so anyone can check it. */
  formula: string;
  /**
   * True when the limit came from cap room rather than from matching. Rule
   * 5.6 absorption buys no hard cap, so Article 4 has to know.
   */
  usedCapRoom: boolean;
};

export type MaxIncomingInput = {
  outgoing: number;
  /** Rule 3.4 — the tier the team lands in. */
  tierAfter: Tier;
  cap: EffectiveCap;
  /** Cap space the team had **before** the trade, which may be negative. */
  capRoomBefore: number;
  /**
   * Whether the team was under the cap **before** the trade. The cap-room
   * rule is keyed on that, not on where the team ends up: a team that absorbs
   * salary into its room usually finishes over the cap, and reading the
   * post-trade tier would send it to the bands instead.
   */
  wasBelowCapBefore: boolean;
};

/**
 * Article 5 — the maximum salary a team may take back in a trade.
 *
 * Four rules, in the order the rule book tests them:
 *
 *   under the cap before the trade  →  cap room + allowance, or the bands if
 *                                      they are larger
 *   over the cap, under the tax     →  the NBA bands
 *   over the tax, under the apron   →  Avora's 110% + $100,000
 *   above either apron              →  100% of outgoing salary
 *
 * Every maximum is rounded **down**: a limit that rounds up lets a trade
 * through by the fraction of a dollar it rounded away.
 */
export function maxIncomingSalary(input: MaxIncomingInput): MaxIncoming {
  const { outgoing, tierAfter, cap, capRoomBefore, wasBelowCapBefore } = input;

  const bands = bandLimit(outgoing, cap);

  // Rule 5.6 — a team under the cap may absorb up to its room plus the trade
  // allowance without matching at all, and Rule 5.3's table says it takes
  // whichever of that and the bands is greater.
  if (wasBelowCapBefore) {
    const room = Math.max(0, capRoomBefore);
    const absorb = Math.floor(room + cap.tradeAllowance);
    if (absorb >= bands.limit) {
      return {
        limit: absorb,
        ruleName: 'Cap room rule',
        formula: `${money(room)} room + ${money(cap.tradeAllowance)} = ${money(absorb)}`,
        usedCapRoom: true,
      };
    }
    return { ...bands, usedCapRoom: false };
  }

  if (tierAfter === TIER.firstApron || tierAfter === TIER.secondApron) {
    const limit = Math.floor(outgoing);
    return {
      limit,
      ruleName: `${TIER_LABEL[tierAfter]} rule`,
      formula: `up to 100% of what they send, ${money(limit)}`,
      usedCapRoom: false,
    };
  }

  // Avora's own rule. The NBA would give a Taxpayer the bands, which allow
  // far more salary; this is the single place the two rule books differ.
  if (tierAfter === TIER.luxuryTax) {
    const limit = Math.floor(
      (outgoing * cap.taxpayerMatchPct) / 100 + cap.taxpayerMatchAddOn,
    );
    return {
      limit,
      ruleName: 'Taxpayer rule',
      formula: `${cap.taxpayerMatchPct}% of ${money(outgoing)} + ${money(cap.taxpayerMatchAddOn)} = ${money(limit)}`,
      usedCapRoom: false,
    };
  }

  return { ...bands, usedCapRoom: false };
}

/**
 * The band formula on its own, for a team that has to match:
 *
 *   max( min(2.00 × out + allowance, out + cushion), 1.25 × out + allowance )
 *
 * which produces the three published bands without storing their edges — only
 * the cushion is stored. The winning term is named so the validation line can
 * show the arithmetic that actually applied.
 */
export function bandLimit(
  outgoing: number,
  cap: EffectiveCap,
): { limit: number; ruleName: string; formula: string } {
  const allowance = cap.tradeAllowance;
  const doubled = 2 * outgoing + allowance;
  const cushioned = outgoing + cap.bandCushion;
  const quarter = 1.25 * outgoing + allowance;

  const chosen = Math.max(Math.min(doubled, cushioned), quarter);
  const limit = Math.floor(chosen);
  const ruleName = 'Over-the-Cap rule';

  if (chosen === quarter) {
    return {
      limit,
      ruleName,
      formula: `125% of ${money(outgoing)} + ${money(allowance)} = ${money(limit)}`,
    };
  }
  if (chosen === cushioned) {
    return {
      limit,
      ruleName,
      formula: `${money(outgoing)} + ${money(cap.bandCushion)} = ${money(limit)}`,
    };
  }
  return {
    limit,
    ruleName,
    formula: `200% of ${money(outgoing)} + ${money(allowance)} = ${money(limit)}`,
  };
}

/**
 * Article 6 — which tools a tier keeps.
 *
 * A Repeat Taxpayer above the Luxury Tax Line loses more on top (Rule 8.4),
 * which is why that is a separate argument rather than a sixth tier.
 */
export type Tools = {
  canAggregate: boolean;
  canUseTradeException: boolean;
  canUseNonTaxpayerMle: boolean;
  canUseTaxpayerMle: boolean;
  canUseBiAnnual: boolean;
  canUseRoomException: boolean;
  canAcquireInSignAndTrade: boolean;
};

export function toolsFor(tier: Tier, isRepeatTaxpayer: boolean): Tools {
  const base: Tools = {
    canAggregate: true,
    canUseTradeException: true,
    canUseNonTaxpayerMle: false,
    canUseTaxpayerMle: false,
    canUseBiAnnual: false,
    canUseRoomException: false,
    canAcquireInSignAndTrade: true,
  };

  switch (tier) {
    case TIER.belowCap:
      // A team that uses cap room gives up the MLEs and the Bi-Annual for the
      // league year and gets the Room Exception instead (Article 6).
      base.canUseRoomException = true;
      break;
    case TIER.overCap:
    case TIER.luxuryTax:
      base.canUseNonTaxpayerMle = true;
      base.canUseTaxpayerMle = true;
      base.canUseBiAnnual = true;
      break;
    case TIER.firstApron:
      base.canUseTaxpayerMle = true;
      base.canAcquireInSignAndTrade = false;
      break;
    case TIER.secondApron:
      base.canAggregate = false;
      base.canUseTradeException = false;
      base.canAcquireInSignAndTrade = false;
      break;
    default:
      break;
  }

  // Rule 8.4 — while a Repeat Taxpayer is above the tax line it loses every
  // MLE, the Bi-Annual, aggregation and trade exceptions. Sign-and-trade
  // acquisitions, Bird rights and minimum contracts stay (Rule 8.5).
  if (
    isRepeatTaxpayer &&
    (tier === TIER.luxuryTax ||
      tier === TIER.firstApron ||
      tier === TIER.secondApron)
  ) {
    base.canAggregate = false;
    base.canUseTradeException = false;
    base.canUseNonTaxpayerMle = false;
    base.canUseTaxpayerMle = false;
    base.canUseBiAnnual = false;
  }

  return base;
}

/**
 * Rule 7.6 — how much a trade exception may absorb, and what hard cap using
 * it creates.
 */
export function tradeExceptionUse(
  tier: Tier,
  isRepeatTaxpayer: boolean,
  cap: EffectiveCap,
  exceptionAmount: number,
): {
  allowed: boolean;
  absorbUpTo: number;
  hardCapAt: Tier | null;
  why?: string;
} {
  if (isRepeatTaxpayer && tier !== TIER.belowCap && tier !== TIER.overCap) {
    return {
      allowed: false,
      absorbUpTo: 0,
      hardCapAt: null,
      why: 'A Repeat Taxpayer above the Luxury Tax Line cannot use a trade exception.',
    };
  }

  if (tier === TIER.secondApron) {
    return {
      allowed: false,
      absorbUpTo: 0,
      hardCapAt: null,
      why: 'A team above the Second Apron cannot use a trade exception.',
    };
  }

  if (tier === TIER.firstApron) {
    return {
      allowed: true,
      absorbUpTo: exceptionAmount,
      hardCapAt: TIER.secondApron,
    };
  }

  return {
    allowed: true,
    absorbUpTo: exceptionAmount + cap.tradeExceptionAllowance,
    hardCapAt: TIER.firstApron,
  };
}
