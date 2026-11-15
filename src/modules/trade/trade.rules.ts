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
  rosterCount: number;
  maxRosterSize: number;
  /** Everything this team owes this season, before the trade. */
  committed: number;
  isRepeatTaxpayer: boolean;
  /** Article 4 — the ceiling this team already carries, if any. */
  hardCap: HardCapState | null;
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

export const rosterAfter = (side: TradeSide) =>
  side.rosterCount - side.outgoingPlayers.length + side.incomingPlayers.length;

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

  const playersOut = side.outgoingPlayers.length;
  const playersIn = side.incomingPlayers.length;
  const roster = side.rosterCount - playersOut + playersIn;

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

  if (context.salaryMatching) {
    checks.push(...matchingCheck(side, context, cap, tier, after));
  }

  if (context.apronRules) {
    checks.push(...apronChecks(side, context, cap, tier, tools, after));
  }

  return checks;
}

function matchingCheck(
  side: TradeSide,
  context: TradeContext,
  cap: EffectiveCap,
  tier: Tier,
  after: number,
): TradeCheck[] {
  const base = { teamId: side.teamId, teamAbbr: side.teamAbbr };

  const { limit, ruleName, formula } = maxIncomingSalary({
    outgoing: side.outgoing,
    tierAfter: tier,
    cap,
    capRoomBefore: cap.salaryCap - side.committed,
    wasBelowCapBefore: side.committed < cap.salaryCap,
  });

  if (side.incoming <= limit) {
    const label =
      ruleName === 'Cap room rule'
        ? `${side.shortName}: salary fits in cap room`
        : `${side.shortName}: salary match OK`;
    return [
      {
        ...base,
        code: `salaryMatch:${side.teamId}`,
        label,
        pass: true,
        severity: 'passed',
        math: `${ruleName}: ${formula}. Taking back ${money(side.incoming)}.`,
      },
    ];
  }

  const over = side.incoming - limit;
  const needed = outgoingNeededFor(side.incoming, side, context);
  const toFix = [`Take back at least ${money(over)} less salary.`];
  if (needed !== null && needed > side.outgoing) {
    toFix.push(`Send out at least ${money(needed - side.outgoing)} more.`);
  }

  return [
    {
      ...base,
      code: `salaryMatch:${side.teamId}`,
      label: `${side.shortName} are taking back too much salary`,
      pass: false,
      severity: 'blocking',
      math: `${ruleName}: ${formula}. Taking back ${money(side.incoming)} — ${money(over)} over.`,
      detail: `${money(after)} after the trade.`,
      toFix,
    },
  ];
}

function apronChecks(
  side: TradeSide,
  context: TradeContext,
  cap: EffectiveCap,
  tier: Tier,
  tools: ReturnType<typeof toolsFor>,
  after: number,
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
