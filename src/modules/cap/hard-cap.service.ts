import { HttpStatus, Injectable } from '@nestjs/common';
import {
  HardCapTrigger,
  LeaguePlayerStatus,
  Prisma,
  RosterSlotType,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import {
  APRON_LABEL,
  HARD_CAP_TRIGGERS,
  HardCapState,
  apronAmount,
  hardCapCheck,
  lowerApron,
} from './cap.hardcap';
import { CapService, type EffectiveCap } from './cap.service';

@Injectable()
export class HardCapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capService: CapService,
  ) {}

  /**
   * Every hard cap in force in a league this year, by team id.
   *
   * Rule 4.6 — a cap belongs to one league year, so a row from a past year
   * simply does not match and nothing has to expire it.
   */
  async forLeague(
    leagueId: number,
    seasonStartYear: number,
    cap: EffectiveCap,
  ): Promise<Map<number, HardCapState>> {
    const rows = await this.prisma.teamHardCap.findMany({
      where: { leagueId, seasonStartYear },
      select: { teamId: true, threshold: true, trigger: true },
    });

    return new Map(
      rows.map((row) => [
        row.teamId,
        {
          apron: row.threshold,
          // Read from today's cap, not from what it was worth at the trigger:
          // if a Super Admin corrects an apron, the ceiling corrects with it.
          amount: apronAmount(row.threshold, cap),
          trigger: row.trigger,
        },
      ]),
    );
  }

  async forTeam(
    leagueId: number,
    teamId: number,
    seasonStartYear: number,
    cap: EffectiveCap,
  ): Promise<HardCapState | null> {
    const row = await this.prisma.teamHardCap.findUnique({
      where: { teamId_seasonStartYear: { teamId, seasonStartYear } },
      select: { leagueId: true, threshold: true, trigger: true },
    });

    if (!row || row.leagueId !== leagueId) return null;

    return {
      apron: row.threshold,
      amount: apronAmount(row.threshold, cap),
      trigger: row.trigger,
    };
  }

  /**
   * The roster count the reserve check uses.
   *
   * Rule 4.8 — two-way players do not count toward the roster minimum, so they
   * do not reduce the number of spots that have to be reserved for.
   */
  async rosterCount(leagueId: number, teamId: number): Promise<number> {
    return this.prisma.leaguePlayer.count({
      where: {
        leagueId,
        teamId,
        status: LeaguePlayerStatus.rostered,
        slotType: { not: RosterSlotType.twoWay },
      },
    });
  }

  /** The salary one open roster spot has to be reserved against (Rule 4.8). */
  async rookieMinimum(cap: EffectiveCap): Promise<number> {
    return this.capService.minimumSalary(cap.salaryCap, 0);
  }

  /**
   * Writes a hard cap, or lowers one that is already there.
   *
   * Rule 4.5 — triggering both in a league year leaves the team capped at the
   * First Apron, the lower ceiling. A second trigger never raises the ceiling,
   * which is why this merges rather than overwrites.
   */
  async apply(input: {
    leagueId: number;
    teamId: number;
    seasonStartYear: number;
    trigger: HardCapTrigger;
    cap: EffectiveCap;
    sourceTradeId?: number;
    note?: string;
    /** The trade's transaction, when one is open. */
    tx?: Prisma.TransactionClient;
  }): Promise<HardCapState> {
    const db = input.tx ?? this.prisma;

    const existing = await db.teamHardCap.findUnique({
      where: {
        teamId_seasonStartYear: {
          teamId: input.teamId,
          seasonStartYear: input.seasonStartYear,
        },
      },
      select: { threshold: true, trigger: true },
    });

    const incoming = HARD_CAP_TRIGGERS[input.trigger].apron;
    const threshold = lowerApron(incoming, existing?.threshold ?? null);
    if (!threshold) {
      throw new AppError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'A hard cap trigger must name an apron.',
      );
    }

    // The trigger recorded is the one that set the ceiling in force. A later
    // Second Apron trigger on a First Apron team changes nothing, so it must
    // not rewrite the reason either.
    const trigger =
      existing && threshold === existing.threshold
        ? existing.trigger
        : input.trigger;

    const amountAtTrigger = apronAmount(threshold, input.cap);

    await db.teamHardCap.upsert({
      where: {
        teamId_seasonStartYear: {
          teamId: input.teamId,
          seasonStartYear: input.seasonStartYear,
        },
      },
      create: {
        leagueId: input.leagueId,
        teamId: input.teamId,
        seasonStartYear: input.seasonStartYear,
        threshold,
        trigger,
        amountAtTrigger,
        sourceTradeId: input.sourceTradeId ?? null,
        note: input.note ?? null,
      },
      update: { threshold, trigger, amountAtTrigger },
    });

    return { apron: threshold, amount: amountAtTrigger, trigger };
  }

  /**
   * Rule 4.6 — every team starts the new league year with no hard cap.
   *
   * Called by the rollover. Rows for past years are deleted rather than left
   * to accumulate; nothing reads them, and the cap page asks about one year.
   */
  async clearForRollover(leagueId: number, newSeasonStartYear: number) {
    const result = await this.prisma.teamHardCap.deleteMany({
      where: { leagueId, seasonStartYear: { lt: newSeasonStartYear } },
    });
    return { cleared: result.count };
  }

  /**
   * Rule 4.7 — what a team's cap page shows: the ceiling, the room left under
   * it, and what reserving the open roster spots costs.
   */
  async statusFor(
    leagueId: number,
    teamId: number,
    seasonStartYear: number,
    teamSalary: number,
  ) {
    const cap = await this.capService.forLeague(leagueId, seasonStartYear);

    const [state, roster, settings] = await Promise.all([
      this.forTeam(leagueId, teamId, seasonStartYear, cap),
      this.rosterCount(leagueId, teamId),
      this.prisma.leagueSettings.findUnique({
        where: { leagueId },
        select: { minRosterSize: true },
      }),
    ]);

    const rookieMinimum = await this.rookieMinimum(cap);

    const result = hardCapCheck(state, {
      teamSalaryAfter: teamSalary,
      rosterAfter: roster,
      rosterMinimum: settings?.minRosterSize ?? 0,
      rookieMinimum,
    });

    return {
      ...result,
      apronLabel: result.apron ? APRON_LABEL[result.apron] : null,
      trigger: state?.trigger ?? null,
      triggerLabel: state ? HARD_CAP_TRIGGERS[state.trigger].label : null,
      rosterCount: roster,
      rosterMinimum: settings?.minRosterSize ?? 0,
      rookieMinimum,
    };
  }
}
