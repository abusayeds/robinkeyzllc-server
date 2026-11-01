import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * What a league's figures actually are for one league year.
 *
 * `source` says where the four thresholds came from. A league on the app's
 * default numbers reads `CapYear`; a custom league reads its own, and Rule
 * 2.6 says an update must never overwrite those.
 */
export type EffectiveCap = {
  seasonStartYear: number;
  source: 'default' | 'custom';

  salaryCap: number;
  luxuryTax: number;
  firstApron: number;
  secondApron: number;
  averagePlayerSalary: number;

  // Rule 2.4 — every one of these is a percentage of this league's own cap.
  salaryFloor: number;
  maxSalary0to6: number;
  maxSalary7to9: number;
  maxSalary10Plus: number;
  stretchLimit: number;
  nonTaxpayerMle: number;
  taxpayerMle: number;
  roomException: number;
  biAnnualException: number;
  bandCushion: number;

  // Article 2 fixed amounts, not tied to the cap.
  tradeAllowance: number;
  tradeExceptionAllowance: number;
  qualifyingOfferAddOn: number;

  // Rule 10.12, as percentages of a prior salary.
  holds: {
    fullBirdAtOrAboveAvg: number;
    fullBirdBelowAvg: number;
    rookieAtOrAboveAvg: number;
    rookieBelowAvg: number;
    earlyBird: number;
    nonBird: number;
  };

  qualifyingOfferPriorSalaryPct: number;

  /** True when the league has no figures for this year at all. */
  isSet: boolean;
};

/** Exception amounts are rounded to the nearest $1,000 (Article 2). */
const toThousand = (value: number) => Math.round(value / 1000) * 1000;

const pct = (cap: number, percent: number) => (cap * percent) / 100;

@Injectable()
export class CapService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves one league's figures for one league year.
   *
   * Everything downstream — tiers, trades, cap sheets, contracts — goes
   * through this, so there is one answer to "what is the first apron here"
   * rather than a multiplier repeated in five files.
   */
  async forLeague(
    leagueId: number,
    seasonStartYear: number,
  ): Promise<EffectiveCap> {
    const [settings, year, rules] = await Promise.all([
      this.prisma.leagueSettings.findUnique({
        where: { leagueId },
        select: {
          useCustomCapNumbers: true,
          customSalaryCap: true,
          customLuxuryTax: true,
          customFirstApron: true,
          customSecondApron: true,
          salaryCap: true,
        },
      }),
      this.prisma.capYear.findUnique({ where: { seasonStartYear } }),
      this.ruleSet(),
    ]);

    const custom =
      settings?.useCustomCapNumbers === true &&
      settings.customSalaryCap !== null;

    // A custom league that has not entered a tax line or an apron falls back
    // to the default percentages of its own cap, which is what Rule 2.6 means
    // by "every percentage still applies, calculated from that league's own
    // cap".
    const salaryCap = custom
      ? (settings.customSalaryCap ?? 0)
      : (year?.salaryCap ?? 0);

    const luxuryTax = custom
      ? (settings.customLuxuryTax ?? Math.round(salaryCap * 1.215))
      : (year?.luxuryTax ?? 0);

    const firstApron = custom
      ? (settings.customFirstApron ?? Math.round(salaryCap * 1.2671))
      : (year?.firstApron ?? 0);

    const secondApron = custom
      ? (settings.customSecondApron ?? Math.round(salaryCap * 1.3439))
      : (year?.secondApron ?? 0);

    return {
      seasonStartYear,
      source: custom ? 'custom' : 'default',

      salaryCap,
      luxuryTax,
      firstApron,
      secondApron,
      averagePlayerSalary: year?.averagePlayerSalary ?? 0,

      salaryFloor: Math.round(pct(salaryCap, rules.salaryFloorPct)),
      maxSalary0to6: Math.round(pct(salaryCap, rules.maxSalary0to6Pct)),
      maxSalary7to9: Math.round(pct(salaryCap, rules.maxSalary7to9Pct)),
      maxSalary10Plus: Math.round(pct(salaryCap, rules.maxSalary10PlusPct)),
      stretchLimit: Math.round(pct(salaryCap, rules.stretchLimitPct)),

      nonTaxpayerMle: toThousand(pct(salaryCap, rules.nonTaxpayerMlePct)),
      taxpayerMle: toThousand(pct(salaryCap, rules.taxpayerMlePct)),
      roomException: toThousand(pct(salaryCap, rules.roomExceptionPct)),
      biAnnualException: toThousand(pct(salaryCap, rules.biAnnualExceptionPct)),
      bandCushion: toThousand(pct(salaryCap, rules.bandCushionPct)),

      tradeAllowance: rules.tradeAllowance,
      tradeExceptionAllowance: rules.tradeExceptionAllowance,
      qualifyingOfferAddOn: rules.qualifyingOfferAddOn,

      holds: {
        fullBirdAtOrAboveAvg: rules.holdFullBirdAtOrAboveAvgPct,
        fullBirdBelowAvg: rules.holdFullBirdBelowAvgPct,
        rookieAtOrAboveAvg: rules.holdRookieAtOrAboveAvgPct,
        rookieBelowAvg: rules.holdRookieBelowAvgPct,
        earlyBird: rules.holdEarlyBirdPct,
        nonBird: rules.holdNonBirdPct,
      },

      qualifyingOfferPriorSalaryPct: rules.qualifyingOfferPriorSalaryPct,

      isSet: salaryCap > 0,
    };
  }

  /** Rule 10.11 — the minimum salary for a player with this much service. */
  async minimumSalary(salaryCap: number, yearsOfService: number) {
    const steps = await this.prisma.minimumSalaryStep.findMany({
      orderBy: { yearsOfService: 'asc' },
    });
    if (steps.length === 0) return 0;

    // The scale stops rising at its last step, which the rule book writes as
    // "10+". Anything beyond it takes that figure.
    const last = steps[steps.length - 1];
    const step =
      steps.find((row) => row.yearsOfService === yearsOfService) ??
      (yearsOfService > last.yearsOfService ? last : steps[0]);

    return Math.round(pct(salaryCap, step.percentOfCap));
  }

  /** Rule 10.2 — the maximum a player may be paid, by years of service. */
  maxSalaryFor(cap: EffectiveCap, yearsOfService: number | null) {
    const yos = yearsOfService ?? 0;
    if (yos >= 10) return cap.maxSalary10Plus;
    if (yos >= 7) return cap.maxSalary7to9;
    return cap.maxSalary0to6;
  }

  async ruleSet() {
    const rules = await this.prisma.capRuleSet.findUnique({ where: { id: 1 } });
    if (!rules) {
      throw new AppError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'The global cap rules are missing. They are seeded on boot.',
      );
    }
    return rules;
  }

  /** Every league year the Super Admin has entered. */
  async years() {
    return this.prisma.capYear.findMany({
      orderBy: { seasonStartYear: 'desc' },
    });
  }
}
