import { HardCapApron, HardCapTrigger } from '@prisma/client';
import {
  APRON_LABEL,
  HARD_CAP_TRIGGERS,
  canTakeOnHardCap,
  hardCapCheck,
  type HardCapState,
} from '../cap/cap.hardcap';
import type { EffectiveCap } from '../cap/cap.service';
import {
  maxIncomingSalary,
  TIER,
  Tier,
  tierFor,
  TIER_LABEL,
  toolsFor,
  tradeExceptionUse,
} from '../cap/cap.tiers';

/**
 * How loudly a result should be shown.
 *
 * `blocking` stops the trade. `headsUp` is a consequence the owner should know
 * about before submitting — a hard cap bought, or a tier crossed — and does
 * not stop anything. `passed` is collapsed behind a "show passed checks"
 * toggle, so a clean trade reads as one line rather than fourteen.
 */
export type CheckSeverity = 'blocking' | 'headsUp' | 'passed';

export type TradeCheck = {
  /** Null for a rule about the whole trade rather than one team. */
  teamId: number | null;
  teamAbbr: string | null;
  /** Stable across requests, so the client can group and de-duplicate. */
  code: string;
  label: string;
  pass: boolean;
  severity: CheckSeverity;
  detail?: string;
  /** The rule that applied and its arithmetic, on one line. */
  math?: string;
  /** One or two ways out, with exact amounts. Only on blocking issues. */
  toFix?: string[];
};

/** One player moving, with enough on him to write a message about him. */
export type TradePlayer = {
  leaguePlayerId: number;
  name: string;
  salary: number;
  /** Rule 5.9 — when a trade last brought him in, if one ever did. */
  tradeAcquiredAt: Date | null;
  /**
   * Rule 4.9 — a two-way player sits in his own pool of slots and holds no
   * standard roster spot, so he is counted apart from the 15.
   */
  isTwoWay: boolean;
};

/** Article 7 — one exception a team has brought to this trade. */
export type TradeExceptionAsset = {
  id: number;
  label: string;
  /** What was left on it before this trade. */
  remaining: number;
};

export type TradeSide = {
  teamId: number;
  teamName: string;
  teamAbbr: string;
  /** "Celtics" out of "Boston Celtics" — what the rule lines call the team. */
  shortName: string;
  /** Salary leaving this team. */
  outgoing: number;
  /** Salary arriving at this team. */
  incoming: number;
  /** The players leaving, for the one-for-one matching test and Rule 5.9. */
  outgoingPlayers: TradePlayer[];
  /** The players arriving, for the one-for-one matching test. */
  incomingPlayers: TradePlayer[];
  /** Assets of any kind, so a pick-only side still counts as sending. */
  assetsOut: number;
  assetsIn: number;
  /** Standard roster players only; two-way players are counted below. */
  rosterCount: number;
  maxRosterSize: number;
  /** Two-way players on the roster today. */
  twoWayCount: number;
  maxTwoWay: number;
  /** Everything this team owes this season, before the trade. */
  committed: number;
  isRepeatTaxpayer: boolean;
  /** Article 4 — the ceiling this team already carries, if any. */
  hardCap: HardCapState | null;
  /**
   * Article 7 — the exceptions this team has put in to absorb salary it
   * takes back. An exception it is trading away is not one of these: that
   * one leaves, and leaves no room behind.
   */
  exceptions: TradeExceptionAsset[];
};

export type TradeContext = {
  cap: EffectiveCap;
  salaryMatching: boolean;
  apronRules: boolean;
  deadlinePassed: boolean;
  deadlineLabel: string | null;
  /** The league's roster minimum, two-way players excluded. */
  rosterMinimum: number;
  /** Kept for callers that still pass it; no rule reads it any more. */
  rookieMinimum?: number;
};

const money = (value: number) =>
  `$${Math.round(value).toLocaleString('en-US')}`;

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

/** Rule 3.4 — every rule is judged on where a team lands, not where it starts. */
export const committedAfter = (side: TradeSide) =>
  side.committed - side.outgoing + side.incoming;

const standardOnly = (players: TradePlayer[]) =>
  players.filter((player) => !player.isTwoWay);

/**
 * The standard roster after the trade.
 *
 * Two-way players are left out of both sides of the arithmetic: sending one
 * away does not open a spot among the 15, and taking one back does not fill
 * one. They have their own ceiling, checked separately.
 */
export const rosterAfter = (side: TradeSide) =>
  side.rosterCount -
  standardOnly(side.outgoingPlayers).length +
  standardOnly(side.incomingPlayers).length;

/** The two-way pool after the trade, measured against its own maximum. */
export const twoWayAfter = (side: TradeSide) =>
  side.twoWayCount -
  side.outgoingPlayers.filter((player) => player.isTwoWay).length +
  side.incomingPlayers.filter((player) => player.isTwoWay).length;

/**
 * The name a rule line uses: the last word of a two-or-more-word team name,
 * which turns "Boston Celtics" into "Celtics", and the whole name otherwise.
 */
export function shortTeamName(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words[words.length - 1] : name.trim();
}

/** A date this many whole months after the given one. */
export function addMonths(from: Date, months: number): Date {
  const to = new Date(from.getTime());
  to.setUTCMonth(to.getUTCMonth() + months);
  return to;
}

const dated = (value: Date) =>
  value.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Rule 5.5 as the NBA writes it.
 *
 * Above the Second Apron a team may still send several players; what it may
 * not do is add two salaries together to cover one incoming contract. So the
 * question is not "how many players are going out" but "can each incoming
 * player be covered by one outgoing player on his own".
 *
 * Pairing the largest incoming with the largest outgoing is optimal: if the
 * biggest contract coming in cannot be met by the biggest going out, no other
 * pairing can meet it either.
 */
export function aggregationNeeded(
  incomingPlayers: TradePlayer[],
  outgoingPlayers: TradePlayer[],
): {
  required: boolean;
  unmatched: TradePlayer | null;
  largest: TradePlayer | null;
} {
  const ins = [...incomingPlayers].sort((a, b) => b.salary - a.salary);
  const outs = [...outgoingPlayers].sort((a, b) => b.salary - a.salary);
  const largest = outs[0] ?? null;

  for (let index = 0; index < ins.length; index += 1) {
    const partner = outs[index];
    if (!partner || partner.salary < ins[index].salary) {
      return { required: true, unmatched: ins[index], largest };
    }
  }

  return { required: false, unmatched: null, largest };
}

/** What the exceptions on one side of a trade ended up carrying. */
export type ExceptionPlan = {
  used: {
    id: number;
    label: string;
    absorbed: number;
    playerIds: number[];
  }[];
  /** Incoming salary the exceptions took on altogether. */
  absorbed: number;
  /**
   * Incoming players no single exception was large enough to take. Only
   * meaningful while salary is still unmatched — Rule 7.4 forbids covering
   * one player with two exceptions, so these cannot be split up.
   */
  unreachable: TradePlayer[];
};

/**
 * Rule 7.4 — which incoming players each exception takes on.
 *
 * An exception may absorb several players at once as long as their combined
 * salary fits inside it, but one player may not be covered by two exceptions
 * and no exception is topped up with outgoing salary. Each player therefore
 * belongs to exactly one exception, or to none.
 *
 * Only as much is spent as the trade actually needs. Using an exception buys
 * a hard cap (Rule 7.6), and an owner who adds one to a trade that was legal
 * without it should not pay that price. Players are taken largest first —
 * that clears the most matching for the fewest exceptions — and each goes
 * into the tightest exception that still fits him, so a large exception is
 * kept back for a large contract.
 */
export function planExceptionUse(input: {
  incomingPlayers: TradePlayer[];
  exceptions: { id: number; label: string; absorbUpTo: number }[];
  /** Incoming salary above what outgoing salary can match. */
  excess: number;
}): ExceptionPlan {
  const pots = input.exceptions.map((exception) => ({
    id: exception.id,
    label: exception.label,
    left: exception.absorbUpTo,
    absorbed: 0,
    playerIds: [] as number[],
  }));

  const players = [...input.incomingPlayers].sort(
    (a, b) => b.salary - a.salary,
  );

  let absorbed = 0;
  const unreachable: TradePlayer[] = [];

  for (const player of players) {
    if (absorbed >= input.excess) break;

    const pot = pots
      .filter((candidate) => candidate.left >= player.salary)
      .sort((a, b) => a.left - b.left)[0];

    if (!pot) {
      unreachable.push(player);
      continue;
    }

    pot.left -= player.salary;
    pot.absorbed += player.salary;
    pot.playerIds.push(player.leaguePlayerId);
    absorbed += player.salary;
  }

  return {
    used: pots
      .filter((pot) => pot.absorbed > 0)
      .map((pot) => ({
        id: pot.id,
        label: pot.label,
        absorbed: pot.absorbed,
        playerIds: pot.playerIds,
      })),
    absorbed,
    unreachable,
  };
}

/**
 * Article 7, settled once for one side of a trade.
 *
 * The matching check spends the exceptions and the apron check charges the
 * hard cap they buy, and the two have to agree, so both read this.
 */
export type ExceptionOutcome = {
  /** False only when the tier forbids it outright (Rules 7.6 and 8.4). */
  allowed: boolean;
  why?: string;
  absorbed: number;
  used: ExceptionPlan['used'];
  unreachable: TradePlayer[];
  /** The largest single exception on offer, for the Rule 7.4 message. */
  largestPot: number;
  /** Null when nothing was spent, so nothing was bought. */
  trigger: HardCapTrigger | null;
};

export function exceptionOutcome(
  side: TradeSide,
  cap: EffectiveCap,
  tier: Tier,
  /** Incoming salary outgoing salary can match on its own. */
  limit: number,
): ExceptionOutcome {
  const idle: ExceptionOutcome = {
    allowed: true,
    absorbed: 0,
    used: [],
    unreachable: [],
    largestPot: 0,
    trigger: null,
  };

  const excess = side.incoming - limit;
  if (side.exceptions.length === 0 || excess <= 0) return idle;

  const allowance = exceptionAllowance(side, tier, cap);
  if (!allowance.allowed) {
    return { ...idle, allowed: false, why: allowance.why };
  }

  const plan = planExceptionUse({
    incomingPlayers: side.incomingPlayers,
    exceptions: allowance.pots,
    excess,
  });

  // Rule 7.6 — below the First Apron the ceiling bought is the First Apron;
  // between the aprons it is the Second. `tradeExceptionUse` already decided
  // which, so the trigger is read off that rather than re-tested here.
  const trigger =
    plan.absorbed === 0
      ? null
      : allowance.hardCapAt === TIER.secondApron
        ? HardCapTrigger.tradeExceptionBetweenAprons
        : HardCapTrigger.tradeExceptionBelowFirstApron;

  return {
    allowed: true,
    absorbed: plan.absorbed,
    used: plan.used,
    unreachable: plan.unreachable,
    largestPot: allowance.pots.reduce(
      (most, pot) => Math.max(most, pot.absorbUpTo),
      0,
    ),
    trigger,
  };
}

/**
 * What each exception actually spends in this trade.
 *
 * `process()` must take exactly what the checks allowed off each exception,
 * so it asks the same code rather than working the figure out a second time
 * and risking a different answer.
 */
export function exceptionSpend(
  side: TradeSide,
  context: TradeContext,
): { id: number; absorbed: number }[] {
  if (!context.salaryMatching || side.exceptions.length === 0) return [];

  const tier = tierFor(committedAfter(side), context.cap);
  const { limit } = maxIncomingSalary({
    outgoing: side.outgoing,
    tierAfter: tier,
    cap: context.cap,
    capRoomBefore: context.cap.salaryCap - side.committed,
    wasBelowCapBefore: side.committed < context.cap.salaryCap,
  });

  return exceptionOutcome(side, context.cap, tier, limit).used.map((row) => ({
    id: row.id,
    absorbed: row.absorbed,
  }));
}

/**
 * Rule 7.6 — how much each of a side's exceptions may absorb at this tier,
 * and whether it may be used at all.
 */
export function exceptionAllowance(
  side: TradeSide,
  tier: Tier,
  cap: EffectiveCap,
): {
  allowed: boolean;
  why?: string;
  hardCapAt: Tier | null;
  pots: { id: number; label: string; absorbUpTo: number }[];
} {
  const ruling = tradeExceptionUse(tier, side.isRepeatTaxpayer, cap, 0);
  if (!ruling.allowed) {
    return { allowed: false, why: ruling.why, hardCapAt: null, pots: [] };
  }

  return {
    allowed: true,
    hardCapAt: ruling.hardCapAt,
    pots: side.exceptions.map((exception) => ({
      id: exception.id,
      label: exception.label,
      absorbUpTo: tradeExceptionUse(
        tier,
        side.isRepeatTaxpayer,
        cap,
        exception.remaining,
      ).absorbUpTo,
    })),
  };
}

/**
 * The smallest outgoing salary that would make this much incoming salary
 * legal, found by search rather than by inverting four formulas by hand.
 *
 * Every maximum in Article 5 rises with outgoing salary, so the answer can be
 * bisected. Sending as much as is coming in always satisfies the strictest
 * rule — 100% matching — which bounds the search.
 */
function outgoingNeededFor(
  incoming: number,
  side: TradeSide,
  context: TradeContext,
): number | null {
  const limitAt = (outgoing: number) =>
    maxIncomingSalary({
      outgoing,
      tierAfter: tierFor(side.committed - outgoing + incoming, context.cap),
      cap: context.cap,
      capRoomBefore: context.cap.salaryCap - side.committed,
      wasBelowCapBefore: side.committed < context.cap.salaryCap,
    }).limit;

  let low = Math.ceil(side.outgoing);
  let high = Math.max(low, Math.ceil(incoming));
  if (limitAt(high) < incoming) return null;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (limitAt(middle) >= incoming) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Judges a trade against the AVORA CBA.
 *
 * Returns every rule for every team, in all three severities — a three-team
 * deal that breaks in two places should say so once, not reveal the second
 * problem after the first is fixed.
 */
export function checkTrade(
  sides: TradeSide[],
  context: TradeContext,
): TradeCheck[] {
  const checks: TradeCheck[] = [];
  const { cap } = context;

  if (context.deadlinePassed) {
    checks.push({
      teamId: null,
      teamAbbr: null,
      code: 'deadline',
      label: 'The trade deadline has passed',
      pass: false,
      severity: 'blocking',
      detail: context.deadlineLabel
        ? `The deadline (${context.deadlineLabel}) has passed.`
        : 'The deadline has passed.',
    });
  } else {
    checks.push({
      teamId: null,
      teamAbbr: null,
      code: 'deadline',
      label: 'Before the trade deadline',
      pass: true,
      severity: 'passed',
    });
  }

  // A team added to the trade with nothing going either way is not in the
  // trade yet. Its salary and cap checks are skipped until it is, because
  // "taking back $0 against $0 allowed" tells the owner nothing.
  const empty = sides.filter(
    (side) => side.assetsOut === 0 && side.assetsIn === 0,
  );
  for (const side of empty) {
    checks.push({
      teamId: side.teamId,
      teamAbbr: side.teamAbbr,
      code: `noAssets:${side.teamId}`,
      label: `The ${side.shortName} aren't part of this trade yet`,
      pass: false,
      severity: 'blocking',
      detail: 'Nothing is going to or from this team.',
      toFix: [`Add an asset from the ${side.shortName}, or remove them.`],
    });
  }

  const active = sides.filter((side) => !empty.includes(side));

  // A pick or an exception counts: a team that sends a first-round pick has
  // sent something, even though no salary moved with it.
  const silent = active.filter((side) => side.assetsOut === 0);
  if (silent.length > 0) {
    const names = silent.map((side) => `the ${side.shortName}`);
    const listed =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    checks.push({
      teamId: silent.length === 1 ? silent[0].teamId : null,
      teamAbbr: silent.length === 1 ? silent[0].teamAbbr : null,
      code: 'sendsSomething',
      label: `${listed.charAt(0).toUpperCase()}${listed.slice(1)} must send at least one asset (a player or draft pick)`,
      pass: false,
      severity: 'blocking',
      detail: 'A team that sends nothing is a giveaway, not a trade.',
      toFix: silent.map(
        (side) => `Add a player or draft pick from the ${side.shortName}.`,
      ),
    });
  } else if (active.length > 0) {
    checks.push({
      teamId: null,
      teamAbbr: null,
      code: 'sendsSomething',
      label: 'Each team sends at least one asset',
      pass: true,
      severity: 'passed',
    });
  }

  for (const side of active) {
    checks.push(...teamChecks(side, context, cap));
  }

  return dedupe(checks);
}

function teamChecks(
  side: TradeSide,
  context: TradeContext,
  cap: EffectiveCap,
): TradeCheck[] {
  const checks: TradeCheck[] = [];
  const base = { teamId: side.teamId, teamAbbr: side.teamAbbr };

  const after = committedAfter(side);
  const tierBefore = tierFor(side.committed, cap);
  const tier = tierFor(after, cap);
  const tools = toolsFor(tier, side.isRepeatTaxpayer);

  const roster = rosterAfter(side);
  const twoWay = twoWayAfter(side);

  // Rule 4.9 — the two-way pool, counted apart from the 15 and reported
  // whether it passes or not: a rule that only speaks up when it fails is
  // indistinguishable from one nobody wrote.
  if (twoWay > side.maxTwoWay) {
    checks.push({
      ...base,
      code: `twoWayMax:${side.teamId}`,
      label: `${side.shortName} would have ${twoWay} two-way players (max ${side.maxTwoWay})`,
      pass: false,
      severity: 'blocking',
      detail: `This league allows ${side.maxTwoWay} two-way ${plural(side.maxTwoWay, 'player', 'players')}. They hold ${side.twoWayCount} today.`,
      toFix: ['Take back 1 fewer two-way player, or send out 1 more.'],
    });
  } else {
    checks.push({
      ...base,
      code: `twoWayMax:${side.teamId}`,
      label: `${side.shortName} two-way players: ${twoWay} of ${side.maxTwoWay}`,
      pass: true,
      severity: 'passed',
      detail:
        'Two-way players hold none of the 15 standard roster spots, so they are counted on their own.',
    });
  }

  // Rule 4.9 — the roster maximum.
  if (roster <= side.maxRosterSize) {
    checks.push({
      ...base,
      code: `rosterMax:${side.teamId}`,
      label: `${side.shortName} roster: ${roster} of ${side.maxRosterSize}`,
      pass: true,
      severity: 'passed',
    });
  } else {
    checks.push({
      ...base,
      code: `rosterMax:${side.teamId}`,
      label: `${side.shortName} would have ${roster} players (max ${side.maxRosterSize})`,
      pass: false,
      severity: 'blocking',
      toFix: ['Take back 1 fewer player, or send out 1 more.'],
    });
  }

  // The league's own minimum, which was not being enforced at all.
  if (context.rosterMinimum > 0 && roster < context.rosterMinimum) {
    checks.push({
      ...base,
      code: `rosterMin:${side.teamId}`,
      label: `${side.shortName} would have ${roster} players (min ${context.rosterMinimum})`,
      pass: false,
      severity: 'blocking',
      toFix: ['Send out 1 fewer player, or take back 1 more.'],
    });
  }

  if (!cap.isSet) {
    checks.push({
      ...base,
      code: `capNotSet:${side.teamId}`,
      label: `${side.shortName}: no salary cap set for this league year`,
      pass: true,
      severity: 'passed',
      detail: 'Nothing is checked against a cap that has not been entered.',
    });
    return checks;
  }

  // The tier a trade moves a team into is a consequence, not a rule, so it is
  // a heads-up and only appears when the trade actually moves them.
  if (tier !== tierBefore) {
    checks.push({
      ...base,
      code: `tierChange:${side.teamId}`,
      label: `${side.shortName}: ${TIER_LABEL[tierBefore]} → ${TIER_LABEL[tier]}`,
      pass: true,
      severity: 'headsUp',
      detail: `${money(after)} after the trade.`,
    });
  }

  // Article 5's ceiling and Article 7's exceptions are settled together:
  // what an exception absorbs is not matched, and what it absorbs decides
  // the hard cap the trade buys.
  const { limit, ruleName, formula } = maxIncomingSalary({
    outgoing: side.outgoing,
    tierAfter: tier,
    cap,
    capRoomBefore: cap.salaryCap - side.committed,
    wasBelowCapBefore: side.committed < cap.salaryCap,
  });
  const exceptions = exceptionOutcome(side, cap, tier, limit);

  if (context.salaryMatching) {
    checks.push(
      ...matchingCheck(side, context, cap, tier, after, {
        limit,
        ruleName,
        formula,
        exceptions,
      }),
    );
  }

  if (context.apronRules) {
    checks.push(
      ...apronChecks(side, context, cap, tier, tools, after, exceptions),
    );
  }

  return checks;
}

function matchingCheck(
  side: TradeSide,
  context: TradeContext,
  cap: EffectiveCap,
  tier: Tier,
  after: number,
  article5: {
    limit: number;
    ruleName: string;
    formula: string;
    exceptions: ExceptionOutcome;
  },
): TradeCheck[] {
  const base = { teamId: side.teamId, teamAbbr: side.teamAbbr };
  const { limit, ruleName, formula, exceptions: outcome } = article5;

  const excess = side.incoming - limit;

  if (excess <= 0) {
    const label =
      ruleName === 'Cap room rule'
        ? `${side.shortName}: salary fits in cap room`
        : `${side.shortName}: salary match OK`;
    const checks: TradeCheck[] = [
      {
        ...base,
        code: `salaryMatch:${side.teamId}`,
        label,
        pass: true,
        severity: 'passed',
        math: `${ruleName}: ${formula}. Taking back ${money(side.incoming)}.`,
      },
    ];

    // Rule 7.4 — an exception that was not needed keeps its balance, so the
    // owner is told rather than quietly charged a hard cap for it.
    if (side.exceptions.length > 0) {
      checks.push({
        ...base,
        code: `exceptionUnused:${side.teamId}`,
        label: `${side.shortName} don't need a trade exception for this`,
        pass: true,
        severity: 'passed',
        detail:
          'Outgoing salary covers what is coming back, so nothing is taken off the exception and no hard cap is bought.',
      });
    }

    return checks;
  }

  // Article 7 — what matching cannot cover, an exception may.
  const checks: TradeCheck[] = [];
  const absorbed = outcome.absorbed;

  if (side.exceptions.length > 0 && !outcome.allowed) {
    checks.push({
      ...base,
      code: `exceptionTier:${side.teamId}`,
      label: `${side.shortName} can't use a trade exception at this payroll`,
      pass: false,
      severity: 'blocking',
      detail: outcome.why,
      math: `Rule 7.6 — ${TIER_LABEL[tier]} after the trade.`,
      toFix: [
        `Take the exception out of the trade and match ${money(side.incoming)} with salary.`,
      ],
    });
  }

  if (absorbed > 0) {
    const named = outcome.used
      .map((row) => `${row.label} (${money(row.absorbed)})`)
      .join(', ');
    checks.push({
      ...base,
      code: `exceptionUse:${side.teamId}`,
      label: `${side.shortName} absorb ${money(absorbed)} with a trade exception`,
      pass: true,
      severity: 'passed',
      math: `Rule 7.6 — ${named}.`,
    });
  }

  // Rule 7.4 — two exceptions may not be put together for one player, so a
  // contract larger than every single exception cannot be split across them.
  if (
    outcome.allowed &&
    side.incoming - absorbed > limit &&
    outcome.unreachable.length > 0 &&
    outcome.largestPot > 0
  ) {
    const stuck = outcome.unreachable[0];
    checks.push({
      ...base,
      code: `exceptionSplit:${side.teamId}`,
      label: `${side.shortName} can't cover ${stuck.name} with two exceptions`,
      pass: false,
      severity: 'blocking',
      detail: `Rule 7.4 — one player has to fit inside a single exception. The largest available holds ${money(outcome.largestPot)}.`,
      math: `${stuck.name}: ${money(stuck.salary)}.`,
    });
  }

  const unmatched = side.incoming - absorbed;

  if (unmatched <= limit) {
    checks.push({
      ...base,
      code: `salaryMatch:${side.teamId}`,
      label: `${side.shortName}: salary match OK`,
      pass: true,
      severity: 'passed',
      math: `${ruleName}: ${formula}. Matching ${money(unmatched)} after the exception.`,
    });
    return checks;
  }

  const over = unmatched - limit;
  const needed = outgoingNeededFor(unmatched, side, context);
  const toFix = [`Take back at least ${money(over)} less salary.`];
  if (needed !== null && needed > side.outgoing) {
    toFix.push(`Send out at least ${money(needed - side.outgoing)} more.`);
  }

  checks.push({
    ...base,
    code: `salaryMatch:${side.teamId}`,
    label: `${side.shortName} are taking back too much salary`,
    pass: false,
    severity: 'blocking',
    math: `${ruleName}: ${formula}. Taking back ${money(unmatched)} — ${money(over)} over.`,
    detail: `${money(after)} after the trade.`,
    toFix,
  });

  return checks;
}

function apronChecks(
  side: TradeSide,
  context: TradeContext,
  cap: EffectiveCap,
  tier: Tier,
  tools: ReturnType<typeof toolsFor>,
  after: number,
  exceptions: ExceptionOutcome,
): TradeCheck[] {
  const checks: TradeCheck[] = [];
  const base = { teamId: side.teamId, teamAbbr: side.teamAbbr };

  const playersOut = side.outgoingPlayers.length;
  const pairing = aggregationNeeded(side.incomingPlayers, side.outgoingPlayers);

  // Rule 5.5 — the ban is on combining salaries, not on sending two players.
  const combining = playersOut > 1 && pairing.required;

  if (playersOut > 1) {
    if (!combining) {
      checks.push({
        ...base,
        code: `aggregation:${side.teamId}`,
        label: `${side.shortName}: no salaries combined`,
        pass: true,
        severity: 'passed',
        detail: `Each incoming player is matched by one outgoing player, so ${playersOut} ${plural(playersOut, 'player', 'players')} can go out without combining anything.`,
      });
    } else if (!tools.canAggregate) {
      const unmatched = pairing.unmatched;
      const largest = pairing.largest;
      const toFix: string[] = [];
      if (unmatched) {
        toFix.push(
          `Include one ${side.shortName} player earning at least ${money(unmatched.salary)}.`,
        );
      }
      const shedTo = tier === TIER.secondApron ? after - cap.secondApron : 0;
      if (shedTo > 0) {
        toFix.push(
          `Shed ${money(shedTo)} more so the ${side.shortName} finish at or under the Second Apron.`,
        );
      }

      checks.push({
        ...base,
        code: `aggregation:${side.teamId}`,
        label: `${side.shortName} can't combine player salaries`,
        pass: false,
        severity: 'blocking',
        math: side.isRepeatTaxpayer
          ? 'A Repeat Taxpayer above the Luxury Tax Line cannot combine salaries.'
          : unmatched && largest
            ? `Above the Second Apron, each incoming player must be matched by one outgoing player. ${unmatched.name} (${money(unmatched.salary)}) earns more than any single ${side.shortName} player being sent (largest: ${largest.name}, ${money(largest.salary)}).`
            : 'Above the Second Apron, each incoming player must be matched by one outgoing player.',
        toFix,
      });
    } else {
      checks.push({
        ...base,
        code: `aggregation:${side.teamId}`,
        label: `${side.shortName}: salaries combined`,
        pass: true,
        severity: 'passed',
        detail: `${playersOut} salaries combined to make the match.`,
      });
    }
  }

  // Rule 5.9 — a player who arrived by trade cannot be added to another
  // salary for two months. He can still be traded on his own, which is why
  // this only fires when the team is actually combining.
  if (combining && tools.canAggregate) {
    const check = aggregationWaitCheck(side, cap);
    if (check) checks.push({ ...base, ...check });
  }

  // Rule 4.2 — which moves in this trade would buy a hard cap.
  const triggers: HardCapTrigger[] = [];
  // Rule 5.6 — absorbing into cap room buys no ceiling, so a team that was
  // under the cap before the trade is left alone here.
  const absorbed = side.committed < cap.salaryCap;
  if (side.incoming > side.outgoing && !absorbed) {
    triggers.push(HardCapTrigger.tookBackMoreSalary);
  }
  if (combining && tools.canAggregate) {
    triggers.push(HardCapTrigger.aggregatedSalaries);
  }
  // Rule 7.6 — only a trade that actually spends an exception buys its
  // ceiling. One added and left untouched costs nothing.
  if (exceptions.trigger) {
    triggers.push(exceptions.trigger);
  }

  const reserve = { teamSalaryAfter: after };
  const existing = side.hardCap?.apron ?? null;

  for (const trigger of triggers) {
    const result = canTakeOnHardCap(trigger, reserve, cap, existing);
    const apron = result.apron!;
    const bought = HARD_CAP_TRIGGERS[trigger].apron;

    // Rule 4.5 — the lower ceiling wins. When that is a cap the team already
    // carried, the message has to name the earlier move as the cause rather
    // than blame this trade for a ceiling it did not buy.
    const fromEarlier = existing !== null && apron !== bought;
    const cause = fromEarlier
      ? `The ${side.shortName} already carry a ${APRON_LABEL[apron]} hard cap from an earlier move (${HARD_CAP_TRIGGERS[side.hardCap!.trigger].label.toLowerCase()}), and that lower ceiling is the one that applies.`
      : trigger === HardCapTrigger.aggregatedSalaries
        ? `Combining salaries caps the ${side.shortName} at the ${APRON_LABEL[apron]} (${money(result.ceiling!)}) for the rest of the season.`
        : `This trade caps the ${side.shortName} at the ${APRON_LABEL[apron]} (${money(result.ceiling!)}) for the rest of the season.`;

    if (result.pass) {
      checks.push({
        ...base,
        code: `hardCap:${side.teamId}:${trigger}`,
        label: `Hard cap — ${side.shortName} at the ${APRON_LABEL[apron]}`,
        pass: true,
        severity: 'headsUp',
        detail: `${cause} Room left: ${money(result.room!)}.`,
      });
    } else {
      checks.push({
        ...base,
        code: `hardCap:${side.teamId}:${trigger}`,
        label: `${side.shortName} would end over their hard cap`,
        pass: false,
        severity: 'blocking',
        math: `${cause} ${result.message}`,
        toFix: [
          `Take back at least ${money(result.shortfall)} less salary.`,
          `Send out at least ${money(result.shortfall)} more.`,
        ],
      });
    }
  }

  // Rules 4.3 — a team already hard-capped is measured against its ceiling on
  // every later move, even when this trade buys no new cap.
  if (side.hardCap && triggers.length === 0) {
    const result = hardCapCheck(side.hardCap, reserve);
    const apron = side.hardCap.apron;
    if (result.pass) {
      checks.push({
        ...base,
        code: `hardCapExisting:${side.teamId}`,
        label: `${side.shortName} stay under their ${APRON_LABEL[apron]} hard cap`,
        pass: true,
        severity: 'passed',
        detail: `From an earlier move: ${HARD_CAP_TRIGGERS[side.hardCap.trigger].label.toLowerCase()}. ${result.message}`,
      });
    } else {
      checks.push({
        ...base,
        code: `hardCapExisting:${side.teamId}`,
        label: `${side.shortName} would end over their hard cap`,
        pass: false,
        severity: 'blocking',
        math: `The ${side.shortName} already carry a ${APRON_LABEL[apron]} hard cap from an earlier move (${HARD_CAP_TRIGGERS[side.hardCap.trigger].label.toLowerCase()}). ${result.message}`,
        toFix: [
          `Take back at least ${money(result.shortfall)} less salary.`,
          `Send out at least ${money(result.shortfall)} more.`,
        ],
      });
    }
  }

  return checks;
}

/** Rule 5.9 — the two-month wait on a player who arrived by trade. */
function aggregationWaitCheck(
  side: TradeSide,
  cap: EffectiveCap,
): Omit<TradeCheck, 'teamId' | 'teamAbbr'> | null {
  const now = new Date();
  const months = cap.aggregationWaitMonths;

  const blocked = side.outgoingPlayers
    .filter((player) => player.tradeAcquiredAt !== null)
    .map((player) => ({
      player,
      until: addMonths(player.tradeAcquiredAt as Date, months),
    }))
    .filter((row) => row.until > now);

  if (blocked.length === 0) return null;

  const first = blocked[0];
  const others = side.outgoingPlayers.filter(
    (player) =>
      !blocked.some(
        (row) => row.player.leaguePlayerId === player.leaguePlayerId,
      ),
  );

  const toFix: string[] = [];
  if (others.length > 0 && side.incomingPlayers.length > 0) {
    const removed = others.map((player) => player.name).join(' and ');
    const received = side.incomingPlayers
      .map((player) => player.name)
      .join(' and ');
    toFix.push(
      `Remove ${removed} and trade ${first.player.name} for ${received} straight up.`,
    );
  }
  toFix.push(
    `Wait until ${dated(first.until)}, or combine salaries that did not arrive by trade.`,
  );

  return {
    code: `aggregationWait:${side.teamId}`,
    label: `${side.shortName} can't combine ${first.player.name}'s salary yet`,
    pass: false,
    severity: 'blocking',
    math: blocked
      .map(
        (row) =>
          `${row.player.name} was acquired by trade on ${dated(row.player.tradeAcquiredAt as Date)} and can't be combined with another salary until ${dated(row.until)} (${months} months).`,
      )
      .join(' '),
    detail: `He can still be traded on his own, and his salary can still match incoming salary by itself.`,
    toFix,
  };
}

/**
 * One problem, one line.
 *
 * A team that takes back too much salary usually breaks its hard cap by the
 * very same dollars, and showing both makes it look like two separate things
 * to fix. When the amounts agree, the salary rule is the one that explains it.
 */
function dedupe(checks: TradeCheck[]): TradeCheck[] {
  const overageOf = new Map<number, number>();
  for (const check of checks) {
    if (
      !check.pass &&
      check.teamId !== null &&
      check.code.startsWith('salaryMatch:')
    ) {
      const match = /— \$([\d,]+) over/.exec(check.math ?? '');
      if (match) {
        overageOf.set(check.teamId, Number(match[1].replace(/,/g, '')));
      }
    }
  }

  return checks.filter((check) => {
    if (check.pass || check.teamId === null) return true;
    if (!check.code.startsWith('hardCap')) return true;
    const overage = overageOf.get(check.teamId);
    if (overage === undefined) return true;
    const shortfall = /\$([\d,]+) over the (?:First|Second) Apron/.exec(
      check.math ?? '',
    );
    return shortfall
      ? Number(shortfall[1].replace(/,/g, '')) !== overage
      : true;
  });
}

/** A trade is legal when nothing blocking is outstanding. Heads-ups do not stop it. */
export const tradeIsLegal = (checks: TradeCheck[]) =>
  checks.every((check) => check.pass || check.severity !== 'blocking');

export const blockingChecks = (checks: TradeCheck[]) =>
  checks.filter((check) => !check.pass && check.severity === 'blocking');

/**
 * Rule 7.1 — the exception a team earns.
 *
 * Sized from the **single largest outgoing salary used for matching**, not
 * from everything the team sent out. A team that sends two $10M players and
 * takes back $12M earns $0, not $8M: only one of those salaries did the
 * matching.
 */
export function exceptionFor(input: {
  /** The single largest outgoing player salary. */
  largestOutgoing: number;
  incoming: number;
}): number | null {
  const difference = input.largestOutgoing - input.incoming;
  return difference > 0 ? difference : null;
}

export { TIER, TIER_LABEL, tierFor, HardCapApron };
export type { Tier };
