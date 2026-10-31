import { ContractOptionType, GuaranteeType } from '@prisma/client';

/**
 * One season cell of an import row, after reading.
 *
 * A cell is never guessed at. Anything the vocabulary below does not cover
 * comes back as `invalid` with a reason the preview can show, because a
 * silently misread salary is worse than a row the commissioner has to look at.
 */
export type ParsedCell =
  | { kind: 'empty' }
  | {
      kind: 'salary';
      amount: number;
      optionType: ContractOptionType | null;
      guaranteeType: GuaranteeType;
      guaranteedAmount: number | null;
    }
  | { kind: 'capHold'; amount: number | null; isQualifyingOffer: boolean }
  | { kind: 'deadMoney'; amount: number; isStretched: boolean }
  | { kind: 'invalid'; reason: string };

type TagRule =
  | {
      kind: 'salary';
      option: ContractOptionType | null;
      guarantee: GuaranteeType;
    }
  | { kind: 'capHold'; isQualifyingOffer: boolean }
  | { kind: 'deadMoney'; isStretched: boolean };

/**
 * Every spelling accepted for a tag, keyed by its reduced form: uppercase,
 * punctuation gone, single spaces. The client asked for the short codes and
 * the readable labels to work alike.
 */
const TAGS: Record<string, TagRule> = {
  '': { kind: 'salary', option: null, guarantee: GuaranteeType.full },

  PO: {
    kind: 'salary',
    option: ContractOptionType.player,
    guarantee: GuaranteeType.full,
  },
  'PLAYER OPTION': {
    kind: 'salary',
    option: ContractOptionType.player,
    guarantee: GuaranteeType.full,
  },

  TO: {
    kind: 'salary',
    option: ContractOptionType.team,
    guarantee: GuaranteeType.full,
  },
  'TEAM OPTION': {
    kind: 'salary',
    option: ContractOptionType.team,
    guarantee: GuaranteeType.full,
  },

  ETO: {
    kind: 'salary',
    option: ContractOptionType.earlyTermination,
    guarantee: GuaranteeType.full,
  },
  'EARLY TERMINATION': {
    kind: 'salary',
    option: ContractOptionType.earlyTermination,
    guarantee: GuaranteeType.full,
  },
  'EARLY TERMINATION OPTION': {
    kind: 'salary',
    option: ContractOptionType.earlyTermination,
    guarantee: GuaranteeType.full,
  },

  NG: { kind: 'salary', option: null, guarantee: GuaranteeType.none },
  'NON GUARANTEED': {
    kind: 'salary',
    option: null,
    guarantee: GuaranteeType.none,
  },
  NONGUARANTEED: {
    kind: 'salary',
    option: null,
    guarantee: GuaranteeType.none,
  },

  PG: { kind: 'salary', option: null, guarantee: GuaranteeType.partial },
  'PARTIALLY GUARANTEED': {
    kind: 'salary',
    option: null,
    guarantee: GuaranteeType.partial,
  },
  'PARTIAL GUARANTEE': {
    kind: 'salary',
    option: null,
    guarantee: GuaranteeType.partial,
  },

  QO: { kind: 'capHold', isQualifyingOffer: true },
  'QUALIFYING OFFER': { kind: 'capHold', isQualifyingOffer: true },

  CH: { kind: 'capHold', isQualifyingOffer: false },
  'CAP HOLD': { kind: 'capHold', isQualifyingOffer: false },

  DC: { kind: 'deadMoney', isStretched: false },
  'DEAD CAP': { kind: 'deadMoney', isStretched: false },

  'DC S': { kind: 'deadMoney', isStretched: true },
  DCS: { kind: 'deadMoney', isStretched: true },
  'DC STRETCHED': { kind: 'deadMoney', isStretched: true },
  'DEAD CAP STRETCHED': { kind: 'deadMoney', isStretched: true },
};

const isWholeNumber = (token: string) => /^\d+$/.test(token);

/**
 * Reads one season cell: an optional whole-dollar amount, then an optional
 * tag, and for a partial guarantee a second amount after the tag.
 *
 * Dollar signs, commas, brackets and hyphens are tolerated on the way in so a
 * commissioner's own spreadsheet does not have to be retyped, but the stored
 * value is always a plain integer.
 */
export function parseSalaryCell(raw: string | null | undefined): ParsedCell {
  const cleaned = (raw ?? '')
    // Dollar signs and thousands separators are deleted, not spaced out:
    // "$4,000,000" has to become one number, not three.
    .replace(/[$,]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/[-–—]/g, ' ')
    .trim();

  if (!cleaned) return { kind: 'empty' };

  const tokens = cleaned.split(/\s+/);

  const amount = isWholeNumber(tokens[0]) ? Number(tokens[0]) : null;
  const rest = amount === null ? tokens : tokens.slice(1);

  // A trailing number belongs to the tag, not to the amount — it is the
  // guaranteed part of a partial guarantee.
  const trailing =
    rest.length > 1 && isWholeNumber(rest[rest.length - 1])
      ? Number(rest[rest.length - 1])
      : null;
  const tagTokens = trailing === null ? rest : rest.slice(0, -1);

  const tag = tagTokens.join(' ').toUpperCase();
  const rule = TAGS[tag];

  if (!rule) {
    return {
      kind: 'invalid',
      reason: `"${(raw ?? '').trim()}" is not a salary or a tag we recognise.`,
    };
  }

  if (rule.kind === 'capHold') {
    // A bare CH is allowed: the hold is worked out from his last salary and
    // bird years. A QO without a figure is treated the same way.
    return {
      kind: 'capHold',
      amount,
      isQualifyingOffer: rule.isQualifyingOffer,
    };
  }

  if (rule.kind === 'deadMoney') {
    if (amount === null) {
      return { kind: 'invalid', reason: 'Dead cap needs an amount.' };
    }
    return { kind: 'deadMoney', amount, isStretched: rule.isStretched };
  }

  if (amount === null) {
    return {
      kind: 'invalid',
      reason: `"${tag}" needs a salary in front of it.`,
    };
  }

  if (rule.guarantee === GuaranteeType.partial) {
    if (trailing === null) {
      return {
        kind: 'invalid',
        reason:
          'A partial guarantee needs the guaranteed amount after the tag, e.g. "2100000 PG 500000".',
      };
    }
    if (trailing > amount) {
      return {
        kind: 'invalid',
        reason: 'The guaranteed amount cannot be more than the salary.',
      };
    }
    return {
      kind: 'salary',
      amount,
      optionType: rule.option,
      guaranteeType: GuaranteeType.partial,
      guaranteedAmount: trailing,
    };
  }

  if (trailing !== null) {
    return {
      kind: 'invalid',
      reason: `"${(raw ?? '').trim()}" has two amounts, which only a partial guarantee uses.`,
    };
  }

  return {
    kind: 'salary',
    amount,
    optionType: rule.option,
    guaranteeType: rule.guarantee,
    guaranteedAmount: null,
  };
}
