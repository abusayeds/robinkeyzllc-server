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

export const TIER_LABEL: Record<Tier, string> = {
  belowCap: 'Below Cap',
  overCap: 'Over Cap, Below Tax',
  luxuryTax: 'Luxury Tax',
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

/**
 * Article 5 — the maximum salary a team may take back in a trade.
 *
 * The rule book gives the formula outright:
 *
 *   max_incoming = max( min(2.00 × out + allowance, out + cushion),
 *                       1.25 × out + allowance )
 *
 * which produces the three published bands without storing their edges —
 * only the cushion is stored. It applies to every team below the First
 * Apron. At or above either apron the limit is 100% of outgoing salary
 * (Rules 5.3 and the tier table).
 */
export function maxIncomingSalary(
  outgoing: number,
  tier: Tier,
  cap: EffectiveCap,
  capRoom: number,
): { limit: number; basis: string } {
  if (tier === TIER.firstApron || tier === TIER.secondApron) {
    return { limit: outgoing, basis: '100% of outgoing salary' };
  }

  const bands = bandLimit(outgoing, cap);

  if (tier === TIER.belowCap) {
    // Rule 5.6 — a team below the cap may absorb up to its room plus the
    // trade allowance without matching at all, and Rule 5.3's table says it
    // takes whichever of the two is greater.
    const room = Math.max(0, capRoom) + cap.tradeAllowance;
    return room >= bands
      ? { limit: room, basis: 'cap room plus the trade allowance' }
      : { limit: bands, basis: 'the salary-matching bands' };
  }

  return { limit: bands, basis: 'the salary-matching bands' };
}

/** The band formula on its own, for a team that has to match. */
export function bandLimit(outgoing: number, cap: EffectiveCap): number {
  const allowance = cap.tradeAllowance;
  const doubled = 2 * outgoing + allowance;
  const cushioned = outgoing + cap.bandCushion;
  const quarter = 1.25 * outgoing + allowance;

  return Math.round(Math.max(Math.min(doubled, cushioned), quarter));
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
