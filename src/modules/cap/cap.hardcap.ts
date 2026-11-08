import { HardCapApron, HardCapTrigger } from '@prisma/client';
import type { EffectiveCap } from './cap.service';

/**
 * Article 4 — the hard cap, as pure functions.
 *
 * A hard cap is not a tier. A team's tier moves with its salary; a hard cap is
 * a ceiling it bought with one move and carries until the rollover, whatever
 * its salary does afterwards (Rules 4.1 and 4.6).
 */

/** Rule 4.2 — the table, with the apron each move buys. */
export const HARD_CAP_TRIGGERS: Record<
  HardCapTrigger,
  { apron: HardCapApron; label: string }
> = {
  tookBackMoreSalary: {
    apron: HardCapApron.firstApron,
    label: 'Taking back more than 100% of outgoing salary in a trade',
  },
  signAndTradeAcquisition: {
    apron: HardCapApron.firstApron,
    label: 'Acquiring a player in a sign-and-trade',
  },
  tradeExceptionBelowFirstApron: {
    apron: HardCapApron.firstApron,
    label: 'Using a trade exception while below the First Apron',
  },
  nonTaxpayerMleAboveTaxpayerAmount: {
    apron: HardCapApron.firstApron,
    label: 'Signing with the Non-Taxpayer MLE above the Taxpayer MLE amount',
  },
  nonTaxpayerMleTradeOrClaim: {
    apron: HardCapApron.firstApron,
    label:
      'Using the Non-Taxpayer MLE to acquire a player by trade or waiver claim',
  },
  biAnnualException: {
    apron: HardCapApron.firstApron,
    label: 'Using the Bi-Annual Exception',
  },
  waivedPlayerAboveMle: {
    apron: HardCapApron.firstApron,
    label:
      'In-season signing of a waived player whose salary before waivers was above the Non-Taxpayer MLE',
  },
  aggregatedSalaries: {
    apron: HardCapApron.secondApron,
    label: 'Aggregating two or more player salaries in a trade',
  },
  tradeExceptionBetweenAprons: {
    apron: HardCapApron.secondApron,
    label: 'Using a trade exception while between the First and Second Apron',
  },
  taxpayerMle: {
    apron: HardCapApron.secondApron,
    label: 'Signing with the Taxpayer MLE',
  },
  signAndTradeSendOut: {
    apron: HardCapApron.secondApron,
    label:
      'Sending out a sign-and-trade player and using his salary to take back a contract',
  },
};

export const APRON_LABEL: Record<HardCapApron, string> = {
  firstApron: 'First Apron',
  secondApron: 'Second Apron',
};

/** What an apron is worth in this league this year. */
export function apronAmount(apron: HardCapApron, cap: EffectiveCap): number {
  return apron === HardCapApron.firstApron ? cap.firstApron : cap.secondApron;
}

/**
 * Rule 4.5 — a team can trigger both in one league year, and the First Apron,
 * being the lower ceiling, is the one that applies.
 */
export function lowerApron(
  a: HardCapApron | null,
  b: HardCapApron | null,
): HardCapApron | null {
  if (!a) return b;
  if (!b) return a;
  return a === HardCapApron.firstApron || b === HardCapApron.firstApron
    ? HardCapApron.firstApron
    : HardCapApron.secondApron;
}

export type HardCapState = {
  apron: HardCapApron;
  amount: number;
  trigger: HardCapTrigger;
};

export type ReserveInput = {
  /** Team Salary once the move is done (Rule 3.4). */
  teamSalaryAfter: number;
  /** Players on the roster once the move is done. Two-way players excluded. */
  rosterAfter: number;
  /** The league's roster minimum, from commissioner settings. */
  rosterMinimum: number;
  /** The 0-years-of-service minimum salary, which fills an open spot. */
  rookieMinimum: number;
};

export type HardCapResult = {
  /** Null when no ceiling applies, which is most teams most of the time. */
  apron: HardCapApron | null;
  ceiling: number | null;
  /** Rule 4.8 — spots still to fill before the league's roster minimum. */
  openSpots: number;
  reserve: number;
  /** Team Salary after the move, plus the reserve. */
  committed: number;
  room: number | null;
  pass: boolean;
  /** How much salary has to be cleared for the move to be legal. */
  shortfall: number;
  message: string;
};

const money = (value: number) =>
  `$${Math.round(value).toLocaleString('en-US')}`;

/**
 * Rule 4.8 — the roster reserve check.
 *
 * A hard-capped team cannot exceed its apron even to sign a minimum contract,
 * so the engine makes sure it can still fill its roster to the league minimum
 * before it lets the team spend. The reserve is counted on every move by a
 * hard-capped team, not only on the one that created the cap.
 */
export function hardCapCheck(
  state: HardCapState | null,
  input: ReserveInput,
): HardCapResult {
  // Only spots below the minimum are reserved. A full roster reserves nothing,
  // and a team over the minimum does not get a refund.
  const openSpots = Math.max(0, input.rosterMinimum - input.rosterAfter);
  const reserve = openSpots * input.rookieMinimum;
  const committed = input.teamSalaryAfter + reserve;

  if (!state) {
    return {
      apron: null,
      ceiling: null,
      openSpots,
      reserve,
      committed,
      room: null,
      pass: true,
      shortfall: 0,
      message: 'No hard cap applies.',
    };
  }

  const room = state.amount - committed;
  const pass = room >= 0;

  return {
    apron: state.apron,
    ceiling: state.amount,
    openSpots,
    reserve,
    committed,
    room,
    pass,
    shortfall: pass ? 0 : -room,
    message: pass
      ? openSpots > 0
        ? `${money(room)} under the ${APRON_LABEL[state.apron]}, after reserving ${money(reserve)} for ${openSpots} open roster spot${openSpots === 1 ? '' : 's'}.`
        : `${money(room)} under the ${APRON_LABEL[state.apron]}.`
      : `${money(-room)} over the ${APRON_LABEL[state.apron]}${
          reserve > 0
            ? `, counting ${money(reserve)} reserved for ${openSpots} open roster spot${openSpots === 1 ? '' : 's'}`
            : ''
        }. That much salary has to be cleared.`,
  };
}

/**
 * Rule 4.2 — the move that creates a hard cap must itself leave the team at or
 * below that apron, so a move that would land above the ceiling it buys is not
 * allowed in the first place.
 */
export function canTakeOnHardCap(
  trigger: HardCapTrigger,
  input: ReserveInput,
  cap: EffectiveCap,
  existing: HardCapApron | null,
): HardCapResult & { trigger: HardCapTrigger } {
  const apron = lowerApron(HARD_CAP_TRIGGERS[trigger].apron, existing);
  const result = hardCapCheck(
    apron ? { apron, amount: apronAmount(apron, cap), trigger } : null,
    input,
  );
  return { ...result, trigger };
}
