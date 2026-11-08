import { HttpStatus, Injectable } from '@nestjs/common';
import { PickProtectionOutcome, Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import {
  PickShape,
  UNTRADEABLE_MESSAGE,
  draftWindowYears,
  draftYearLabel,
  resolveProtection,
  roundLabel,
  untradeableReason,
} from './draft.rules';
import { SetPickProtectionDto } from './dto/set-pick-protection.dto';

/** Only these columns are needed to judge a pick, so only these are read. */
const PICK_RULE_SELECT = {
  id: true,
  seasonStartYear: true,
  round: true,
  originalTeamId: true,
  currentTeamId: true,
  protectedTopN: true,
  protectionOutcome: true,
  protectionFinalYear: true,
  frozenInSeason: true,
  usedAt: true,
} satisfies Prisma.DraftPickSelect;

@Injectable()
export class DraftPicksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The league year a league is in. Held as a label on the league row, so it
   * is parsed rather than stored twice; a league whose label cannot be read
   * falls back to the calendar year, the same way the cap page does.
   */
  async currentSeasonStartYear(leagueId: number) {
    const league = await this.prisma.league.findUnique({
      where: { id: leagueId },
      select: { season: true },
    });

    return (
      (league ? parseSeasonLabel(league.season) : null) ??
      new Date().getUTCFullYear()
    );
  }

  private async settings(leagueId: number) {
    const settings = await this.prisma.leagueSettings.findUnique({
      where: { leagueId },
      select: {
        allowDraftPickTrading: true,
        pickTradingWindowDrafts: true,
      },
    });

    // A league always has a settings row, but a missing one must not read as
    // "trading allowed, window zero".
    return {
      allowDraftPickTrading: settings?.allowDraftPickTrading ?? true,
      pickTradingWindowDrafts: settings?.pickTradingWindowDrafts ?? 7,
    };
  }

  /**
   * The whole pick inventory, grouped by draft year, which is how the
   * commissioner's page reads it.
   */
  async inventory(leagueId: number) {
    const [currentSeasonStartYear, settings, teams, picks] = await Promise.all([
      this.currentSeasonStartYear(leagueId),
      this.settings(leagueId),
      this.prisma.team.findMany({
        where: { leagueId },
        select: { id: true, name: true, abbr: true, logo: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.draftPick.findMany({
        where: { leagueId },
        orderBy: [
          { seasonStartYear: 'asc' },
          { round: 'asc' },
          { originalTeamId: 'asc' },
        ],
        include: {
          originalTeam: {
            select: { id: true, name: true, abbr: true, logo: true },
          },
          currentTeam: {
            select: { id: true, name: true, abbr: true, logo: true },
          },
          owedToTeam: { select: { id: true, name: true, abbr: true } },
          events: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              reason: true,
              createdAt: true,
              tradeId: true,
              fromTeam: { select: { id: true, name: true, abbr: true } },
              toTeam: { select: { id: true, name: true, abbr: true } },
            },
          },
        },
      }),
    ]);

    const ruleShapes: PickShape[] = picks.map((pick) => ({
      id: pick.id,
      seasonStartYear: pick.seasonStartYear,
      round: pick.round,
      originalTeamId: pick.originalTeamId,
      currentTeamId: pick.currentTeamId,
      protectedTopN: pick.protectedTopN,
      protectionOutcome: pick.protectionOutcome,
      protectionFinalYear: pick.protectionFinalYear,
      frozenInSeason: pick.frozenInSeason,
      usedAt: pick.usedAt,
    }));

    const rows = picks.map((pick, index) => {
      const reason = untradeableReason(ruleShapes[index], ruleShapes, {
        currentSeasonStartYear,
        windowDrafts: settings.pickTradingWindowDrafts,
        allowDraftPickTrading: settings.allowDraftPickTrading,
      });

      return {
        id: pick.id,
        seasonStartYear: pick.seasonStartYear,
        year: draftYearLabel(pick.seasonStartYear),
        round: pick.round,
        roundLabel: roundLabel(pick.round),

        currentTeam: pick.currentTeam,
        originalTeam: pick.originalTeam,
        // A pick sitting with the team it was born to has not been traded, and
        // the page shows that differently from one that has.
        isTraded: pick.currentTeamId !== pick.originalTeamId,

        // Rule 12.5 — the page's Protected / Unprotected status is this field
        // and nothing else, so one place decides it.
        status: pick.protectedTopN === null ? 'Unprotected' : 'Protected',
        protectedTopN: pick.protectedTopN,
        protectionOutcome: pick.protectionOutcome,
        protectionFinalYear: pick.protectionFinalYear,
        convertsToPickId: pick.convertsToPickId,
        owedToTeam: pick.owedToTeam,

        // Rules 8.10-8.14.
        isFrozen: pick.frozenInSeason !== null,
        frozenInSeason: pick.frozenInSeason,
        movedToEndOfRound: pick.movedToEndOfRound,

        note: pick.note,
        usedAt: pick.usedAt,

        // Rule 12.11 — the reason travels with the pick, because a status with
        // no reason sends the commissioner looking through the rule book.
        isTradeable: reason === null,
        untradeableReason: reason,
        untradeableMessage: reason ? UNTRADEABLE_MESSAGE[reason] : null,

        history: pick.events.map((event) => ({
          id: event.id,
          fromTeam: event.fromTeam,
          toTeam: event.toTeam,
          reason: event.reason,
          tradeId: event.tradeId,
          at: event.createdAt,
        })),
      };
    });

    const years = draftWindowYears(
      currentSeasonStartYear,
      settings.pickTradingWindowDrafts,
    );

    // Years with picks already in them but outside the window still have to be
    // listed, or a pick would vanish from the page rather than show as
    // untradeable.
    for (const row of rows) {
      if (!years.includes(row.seasonStartYear)) years.push(row.seasonStartYear);
    }
    years.sort((a, b) => a - b);

    return {
      currentSeasonStartYear,
      windowDrafts: settings.pickTradingWindowDrafts,
      allowDraftPickTrading: settings.allowDraftPickTrading,
      teams,
      years: years.map((seasonStartYear) => ({
        seasonStartYear,
        label: draftYearLabel(seasonStartYear),
        inTradingWindow:
          seasonStartYear >= currentSeasonStartYear &&
          seasonStartYear <=
            currentSeasonStartYear + settings.pickTradingWindowDrafts,
        picks: rows.filter((row) => row.seasonStartYear === seasonStartYear),
      })),
    };
  }

  /**
   * Creates the picks a league starts with: one per team, per round, for the
   * current draft and every draft inside the trading window.
   *
   * Safe to run again. `skipDuplicates` leans on the unique key, so a league
   * that gains a team, or a window the commissioner widens, fills in the gaps
   * without touching a pick that has already been traded.
   */
  async generate(leagueId: number, rounds: number) {
    const [currentSeasonStartYear, settings, teams] = await Promise.all([
      this.currentSeasonStartYear(leagueId),
      this.settings(leagueId),
      this.prisma.team.findMany({
        where: { leagueId },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    if (teams.length === 0) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This league has no teams yet, so there are no picks to create.',
      );
    }

    const years = draftWindowYears(
      currentSeasonStartYear,
      settings.pickTradingWindowDrafts,
    );

    const data: Prisma.DraftPickCreateManyInput[] = [];
    for (const seasonStartYear of years) {
      for (let round = 1; round <= rounds; round += 1) {
        for (const team of teams) {
          data.push({
            leagueId,
            seasonStartYear,
            round,
            originalTeamId: team.id,
            currentTeamId: team.id,
          });
        }
      }
    }

    const result = await this.prisma.draftPick.createMany({
      data,
      skipDuplicates: true,
    });

    return {
      created: result.count,
      alreadyPresent: data.length - result.count,
      years: years.map((year) => ({
        seasonStartYear: year,
        label: draftYearLabel(year),
      })),
      rounds,
      teamCount: teams.length,
    };
  }

  private async pickOrThrow(leagueId: number, pickId: number) {
    const pick = await this.prisma.draftPick.findFirst({
      where: { id: pickId, leagueId },
    });
    if (!pick) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Draft pick not found.');
    }
    return pick;
  }

  /**
   * A commissioner moving a pick by hand. Trades go through the trade engine;
   * this is the correction path, which is why it takes a reason and records
   * who did it.
   */
  async reassign(
    leagueId: number,
    pickId: number,
    input: { toTeamId: number; reason?: string },
    actorUserId: number,
  ) {
    const pick = await this.pickOrThrow(leagueId, pickId);

    if (pick.usedAt) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This pick has already been used in a draft and cannot be moved.',
      );
    }

    // Rule 12.3 — frozen means frozen, even for a commissioner: unfreezing is
    // Rule 8.12's job and happens at a rollover.
    if (pick.frozenInSeason !== null) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This pick is frozen under the Second Apron rules and cannot change hands.',
      );
    }

    if (pick.currentTeamId === input.toTeamId) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'That team already holds this pick.',
      );
    }

    const toTeam = await this.prisma.team.findFirst({
      where: { id: input.toTeamId, leagueId },
      select: { id: true },
    });
    if (!toTeam) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'That team is not in this league.',
      );
    }

    const fromTeamId = pick.currentTeamId;

    // One transaction: a moved pick with no history entry would lose the trail
    // Rule 12.10 asks both teams' pages to show.
    const [updated] = await this.prisma.$transaction([
      this.prisma.draftPick.update({
        where: { id: pick.id },
        data: {
          currentTeamId: input.toTeamId,
          note: input.reason?.trim() ? input.reason.trim() : pick.note,
        },
      }),
      this.prisma.draftPickEvent.create({
        data: {
          pickId: pick.id,
          fromTeamId,
          toTeamId: input.toTeamId,
          reason: input.reason?.trim() || null,
          actorUserId,
        },
      }),
    ]);

    return updated;
  }

  /**
   * Rules 12.5-12.7 — the protection on a pick, and what the trade said
   * happens when it holds.
   */
  async setProtection(
    leagueId: number,
    pickId: number,
    input: SetPickProtectionDto,
  ) {
    const pick = await this.pickOrThrow(leagueId, pickId);

    if (pick.usedAt) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This pick has already been used in a draft and cannot be edited.',
      );
    }

    if (input.movedToEndOfRound && pick.frozenInSeason === null) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Only a frozen pick is moved to the end of the round (Rule 8.13).',
      );
    }

    const movedToEndOfRound = input.movedToEndOfRound ?? pick.movedToEndOfRound;

    const clearing =
      input.protectedTopN === null || input.protectedTopN === undefined;

    if (clearing) {
      return this.prisma.draftPick.update({
        where: { id: pick.id },
        data: {
          protectedTopN: null,
          protectionOutcome: null,
          protectionFinalYear: null,
          convertsToPickId: null,
          owedToTeamId: null,
          movedToEndOfRound,
          note:
            input.note === undefined ? pick.note : input.note?.trim() || null,
        },
      });
    }

    // Rule 12.6 — a protection has to say what happens next, or Rule 12.8 has
    // nothing to apply when the order is final.
    if (!input.protectionOutcome) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'A protected pick must say what happens if the protection holds: rollover, convert or end.',
      );
    }

    // Rule 12.7 — a rollover must name its final year.
    if (
      input.protectionOutcome === PickProtectionOutcome.rollover &&
      !input.protectionFinalYear
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'A rollover must name the final year the pick can change hands in.',
      );
    }

    if (
      input.protectionFinalYear !== undefined &&
      input.protectionFinalYear !== null &&
      input.protectionFinalYear < pick.seasonStartYear
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'The final year cannot be before the draft the pick belongs to.',
      );
    }

    if (
      input.protectionOutcome === PickProtectionOutcome.convert &&
      !input.convertsToPickId
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'A conversion must name the pick the obligation converts to.',
      );
    }

    if (input.convertsToPickId) {
      const target = await this.prisma.draftPick.findFirst({
        where: { id: input.convertsToPickId, leagueId },
        select: { id: true },
      });
      if (!target) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'The pick the obligation converts to is not in this league.',
        );
      }
    }

    if (input.owedToTeamId) {
      const owed = await this.prisma.team.findFirst({
        where: { id: input.owedToTeamId, leagueId },
        select: { id: true },
      });
      if (!owed) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          'The team the pick is owed to is not in this league.',
        );
      }
    }

    return this.prisma.draftPick.update({
      where: { id: pick.id },
      data: {
        protectedTopN: input.protectedTopN,
        protectionOutcome: input.protectionOutcome,
        protectionFinalYear: input.protectionFinalYear ?? null,
        convertsToPickId: input.convertsToPickId ?? null,
        owedToTeamId: input.owedToTeamId ?? null,
        movedToEndOfRound,
        note: input.note === undefined ? pick.note : input.note?.trim() || null,
      },
    });
  }

  /**
   * Rule 12.8 — what each protected pick in one draft would do, given where it
   * landed in the order. Read-only: it reports, it does not move anything,
   * because the commissioner finalises the order first.
   */
  async previewProtections(
    leagueId: number,
    seasonStartYear: number,
    landings: { pickId: number; landedAt: number }[],
  ) {
    const picks = await this.prisma.draftPick.findMany({
      where: { leagueId, seasonStartYear, protectedTopN: { not: null } },
      select: PICK_RULE_SELECT,
    });

    const landingByPick = new Map(
      landings.map((landing) => [landing.pickId, landing.landedAt]),
    );

    return picks.map((pick) => {
      const landedAt = landingByPick.get(pick.id);
      if (landedAt === undefined) {
        return {
          pickId: pick.id,
          landedAt: null,
          changesHands: false,
          outcome: 'unresolved' as const,
          message:
            'This pick has no place in the order yet, so its protection cannot be resolved.',
        };
      }
      return resolveProtection(pick, landedAt);
    });
  }
}
