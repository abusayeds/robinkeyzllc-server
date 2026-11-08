import { HardCapTrigger } from '@prisma/client';
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

export type TradeCheck = {
  /** Null for a rule about the whole trade rather than one team. */
  teamId: number | null;
  label: string;
  pass: boolean;
  detail?: string;
};

export type TradeSide = {
  teamId: number;
  teamName: string;
  /** Salary leaving this team. */
  outgoing: number;
  /** Salary arriving at this team. */
  incoming: number;
  /** The largest single outgoing salary, which sizes any exception (Rule 7.1). */
  largestOutgoing: number;
  /** How many separate player salaries this team is sending (Rule 5.5). */
  outgoingPlayerCount: number;
  playersOut: number;
  playersIn: number;
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
  /** Rule 4.8 — the league's roster minimum, two-way players excluded. */
  rosterMinimum: number;
  /** What one open roster spot has to be reserved against (Rule 4.8). */
  rookieMinimum: number;
};

const money = (value: number) =>
  `$${Math.round(value).toLocaleString('en-US')}`;

/** Rule 3.4 — every rule is judged on where a team lands, not where it starts. */
export const committedAfter = (side: TradeSide) =>
  side.committed - side.outgoing + side.incoming;

export const rosterAfter = (side: TradeSide) =>
  side.rosterCount - side.playersOut + side.playersIn;

/**
 * Judges a trade against the AVORA CBA.
 *
 * Returns every rule, passed or failed, for every team — a three-team deal
 * that breaks in two places should say so once, not reveal the second problem
 * after the first is fixed.
 */
export function checkTrade(
  sides: TradeSide[],
  context: TradeContext,
): TradeCheck[] {
  const checks: TradeCheck[] = [];
  const { cap } = context;

  checks.push({
    teamId: null,
    label: 'Before the trade deadline',
    pass: !context.deadlinePassed,
    detail: context.deadlinePassed
      ? `The deadline${context.deadlineLabel ? ` (${context.deadlineLabel})` : ''} has passed.`
      : undefined,
  });

  checks.push({
    teamId: null,
    label: 'Every team sends something',
    pass: sides.every((side) => side.playersOut > 0 || side.outgoing > 0),
    detail: 'A team that sends nothing is a giveaway, not a trade.',
  });

  for (const side of sides) {
    const after = committedAfter(side);
    const tier = tierFor(after, cap);
    const tools = toolsFor(tier, side.isRepeatTaxpayer);

    const roster = rosterAfter(side);
    const fits = roster <= side.maxRosterSize;
    checks.push({
      teamId: side.teamId,
      label: `${side.teamName} has roster room`,
      pass: fits,
      detail: fits
        ? `${roster} of ${side.maxRosterSize} after the trade.`
        : `${roster} players against a limit of ${side.maxRosterSize}.`,
    });

    if (!cap.isSet) {
      checks.push({
        teamId: side.teamId,
        label: `${side.teamName} salary rules`,
        pass: true,
        detail:
          'No salary cap has been entered for this league year, so nothing is checked against one.',
      });
      continue;
    }

    checks.push({
      teamId: side.teamId,
      label: `${side.teamName} finishes in ${TIER_LABEL[tier]}`,
      pass: true,
      detail: `${money(after)} after the trade.`,
    });

    if (context.salaryMatching) {
      const room = cap.salaryCap - side.committed;
      const { limit, basis } = maxIncomingSalary(
        side.outgoing,
        tier,
        cap,
        room,
      );
      const matches = side.incoming <= limit;

      checks.push({
        teamId: side.teamId,
        label: `${side.teamName} salaries match`,
        pass: matches,
        detail: matches
          ? `Taking back ${money(side.incoming)} against ${money(limit)} allowed by ${basis}.`
          : `Taking back ${money(side.incoming)}, more than the ${money(limit)} allowed by ${basis} on ${money(side.outgoing)} sent out.`,
      });
    }

    if (context.apronRules) {
      // Rule 5.5 — aggregating two or more outgoing salaries is not allowed
      // above the Second Apron, nor for a Repeat Taxpayer above the tax line.
      if (side.outgoingPlayerCount > 1) {
        checks.push({
          teamId: side.teamId,
          label: `${side.teamName} may combine salaries`,
          pass: tools.canAggregate,
          detail: tools.canAggregate
            ? `${side.outgoingPlayerCount} salaries combined. This hard-caps the team at the Second Apron.`
            : side.isRepeatTaxpayer
              ? 'A Repeat Taxpayer above the Luxury Tax Line cannot combine salaries.'
              : 'A team above the Second Apron cannot combine salaries.',
        });
      }

      // Rule 4.2 — the moves in this trade that would buy a hard cap. Only
      // the lowest ceiling matters (Rule 4.5), and `canTakeOnHardCap` folds
      // in any cap the team already carries.
      const triggers: HardCapTrigger[] = [];
      if (side.incoming > side.outgoing && tier !== TIER.belowCap) {
        triggers.push(HardCapTrigger.tookBackMoreSalary);
      }
      if (side.outgoingPlayerCount > 1 && tools.canAggregate) {
        triggers.push(HardCapTrigger.aggregatedSalaries);
      }

      const reserve = {
        teamSalaryAfter: after,
        rosterAfter: roster,
        rosterMinimum: context.rosterMinimum,
        rookieMinimum: context.rookieMinimum,
      };

      for (const trigger of triggers) {
        const result = canTakeOnHardCap(
          trigger,
          reserve,
          cap,
          side.hardCap?.apron ?? null,
        );
        checks.push({
          teamId: side.teamId,
          label: `${side.teamName} can carry a ${APRON_LABEL[result.apron!]} hard cap`,
          pass: result.pass,
          detail: `${HARD_CAP_TRIGGERS[trigger].label} caps the team at ${money(result.ceiling!)} for the rest of the league year. ${result.message}`,
        });
      }

      // Rules 4.3 and 4.8 — a team that is already hard-capped is measured
      // against its ceiling on every later move, reserve included, even when
      // this trade buys no new cap.
      if (side.hardCap && triggers.length === 0) {
        const result = hardCapCheck(side.hardCap, reserve);
        checks.push({
          teamId: side.teamId,
          label: `${side.teamName} stays under its ${APRON_LABEL[side.hardCap.apron]} hard cap`,
          pass: result.pass,
          detail: result.message,
        });
      }
    }
  }

  return checks;
}

export const tradeIsLegal = (checks: TradeCheck[]) =>
  checks.every((check) => check.pass);

/**
 * Rule 7.1 — the exception a team earns.
 *
 * Sized from the **single largest outgoing salary used for matching**, not
 * from everything the team sent out. A team that sends two $10M players and
 * takes back $12M earns $0, not $8M: only one of those salaries did the
 * matching.
 */
export function exceptionFor(side: TradeSide): number | null {
  const difference = side.largestOutgoing - side.incoming;
  return difference > 0 ? difference : null;
}

export { TIER, TIER_LABEL, tierFor };
export type { Tier };
