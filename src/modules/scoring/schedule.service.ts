import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Conference,
  MatchupStatus,
  PlayoffRound,
  WeekPhase,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';

/** Three rounds, four teams a conference — the bracket the design draws. */
export const PLAYOFF_WEEKS = 3;
export const PLAYOFF_TEAMS_PER_CONFERENCE = 4;

/**
 * Where the season starts and ends when no NBA games have been synced yet.
 *
 * Mid-October to mid-April is the NBA's own shape. Only a fallback: once games
 * exist, the real first and last night of the season are used instead.
 */
const DEFAULT_SEASON_START = { month: 9, day: 21 };
const DEFAULT_SEASON_END = { month: 3, day: 12 };

const utcDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day));

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

/**
 * The Monday of the week a date falls in.
 *
 * A fantasy week runs Monday to Sunday, which is what every category league
 * does, and it means a week never splits a weekend's games in two.
 */
const mondayOf = (date: Date) => {
  const day = date.getUTCDay();
  // getUTCDay gives 0 for Sunday, so Sunday belongs to the Monday six days back.
  const back = day === 0 ? 6 : day - 1;
  return addDays(date, -back);
};

export type GeneratedSchedule = {
  seasonStartYear: number;
  weeks: number;
  regularWeeks: number;
  playoffWeeks: number;
  matchups: number;
};

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Draws the whole season: every week, every regular matchup, and an empty
   * playoff bracket.
   *
   * Destructive by design — it deletes the existing schedule first, because a
   * half-regenerated season with matchups from two different round-robins is
   * worse than either. Refused once any week has been settled, so a season in
   * progress cannot be rewritten underneath its own results.
   */
  async generate(
    leagueId: number,
    options: { startDate?: string; endDate?: string } = {},
  ): Promise<GeneratedSchedule> {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { id: true, season: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const seasonStartYear =
      parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();

    const settled = await this.prisma.scheduleWeek.count({
      where: { leagueId, seasonStartYear, isSettled: true },
    });
    if (settled > 0) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This season already has settled weeks, so its schedule can no longer be redrawn.',
      );
    }

    const teams = await this.prisma.team.findMany({
      where: { leagueId },
      select: { id: true, conference: true },
      orderBy: { id: 'asc' },
    });
    if (teams.length < 2) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        "A schedule needs at least two teams. Create the league's teams first.",
      );
    }

    const { start, end } = await this.seasonRange(
      seasonStartYear,
      options.startDate,
      options.endDate,
    );

    const weekStarts = this.weekStarts(start, end);
    if (weekStarts.length <= PLAYOFF_WEEKS) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `A season needs more than ${PLAYOFF_WEEKS} weeks: ${PLAYOFF_WEEKS} of them are the playoffs.`,
      );
    }

    const regularWeeks = weekStarts.length - PLAYOFF_WEEKS;
    const rounds = this.roundRobin(teams.map((team) => team.id));

    await this.prisma.$transaction(async (tx) => {
      // Matchups go with their weeks, so one delete clears both.
      await tx.scheduleWeek.deleteMany({
        where: { leagueId, seasonStartYear },
      });

      for (const [index, weekStart] of weekStarts.entries()) {
        const weekNumber = index + 1;
        const isPlayoff = weekNumber > regularWeeks;

        const week = await tx.scheduleWeek.create({
          data: {
            leagueId,
            seasonStartYear,
            weekNumber,
            startDate: weekStart,
            endDate: addDays(weekStart, 6),
            phase: isPlayoff ? WeekPhase.playoffs : WeekPhase.regular,
          },
          select: { id: true },
        });

        if (isPlayoff) continue;

        // The round-robin repeats until the weeks are filled, and the home
        // side swaps each time through so a pairing is not always one way up.
        const round = rounds[index % rounds.length];
        const flipped = Math.floor(index / rounds.length) % 2 === 1;

        await tx.matchup.createMany({
          data: round.map((pair) => ({
            leagueId,
            weekId: week.id,
            homeTeamId: flipped ? pair[1] : pair[0],
            awayTeamId: flipped ? pair[0] : pair[1],
          })),
        });
      }

      await this.drawBracket(tx, leagueId, seasonStartYear, regularWeeks);
    });

    const matchups = await this.prisma.matchup.count({ where: { leagueId } });

    return {
      seasonStartYear,
      weeks: weekStarts.length,
      regularWeeks,
      playoffWeeks: PLAYOFF_WEEKS,
      matchups,
    };
  }

  /**
   * The seven empty playoff matchups.
   *
   * Created with no teams: the bracket is drawn before anybody has qualified,
   * which is what lets the screen show "TBD" for a round whose teams are not
   * known yet. Seeds are set on the semifinals because 1v4 and 2v3 are fixed
   * whoever fills them.
   */
  private async drawBracket(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    leagueId: number,
    seasonStartYear: number,
    regularWeeks: number,
  ) {
    const weeks = await tx.scheduleWeek.findMany({
      where: {
        leagueId,
        seasonStartYear,
        weekNumber: { gt: regularWeeks },
      },
      orderBy: { weekNumber: 'asc' },
      select: { id: true },
    });

    const [semis, finals, championship] = weeks;
    if (!semis || !finals || !championship) return;

    for (const conference of [Conference.east, Conference.west]) {
      await tx.matchup.createMany({
        data: [
          { homeSeed: 1, awaySeed: 4 },
          { homeSeed: 2, awaySeed: 3 },
        ].map((seeds) => ({
          leagueId,
          weekId: semis.id,
          playoffRound: PlayoffRound.semifinal,
          playoffConference: conference,
          ...seeds,
        })),
      });

      await tx.matchup.create({
        data: {
          leagueId,
          weekId: finals.id,
          playoffRound: PlayoffRound.conferenceFinal,
          playoffConference: conference,
        },
      });
    }

    await tx.matchup.create({
      data: {
        leagueId,
        weekId: championship.id,
        playoffRound: PlayoffRound.championship,
        // No conference: the championship belongs to neither.
      },
    });
  }

  /**
   * The season's first and last night.
   *
   * Taken from the NBA games already synced, because a league's weeks should
   * line up with the nights its players are actually playing. The fixed dates
   * are only used before any games exist.
   */
  private async seasonRange(
    seasonStartYear: number,
    startOverride?: string,
    endOverride?: string,
  ) {
    if (startOverride && endOverride) {
      return {
        start: new Date(`${startOverride}T00:00:00Z`),
        end: new Date(`${endOverride}T00:00:00Z`),
      };
    }

    const bounds = await this.prisma.nbaGame.aggregate({
      where: { season: seasonStartYear, postseason: false },
      _min: { date: true },
      _max: { date: true },
    });

    const start =
      (startOverride && new Date(`${startOverride}T00:00:00Z`)) ||
      bounds._min.date ||
      utcDate(
        seasonStartYear,
        DEFAULT_SEASON_START.month,
        DEFAULT_SEASON_START.day,
      );

    const end =
      (endOverride && new Date(`${endOverride}T00:00:00Z`)) ||
      bounds._max.date ||
      utcDate(
        seasonStartYear + 1,
        DEFAULT_SEASON_END.month,
        DEFAULT_SEASON_END.day,
      );

    if (end <= start) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'The season ends before it starts. Check the dates.',
      );
    }

    return { start, end };
  }

  /** Every Monday from the week the season opens to the week it closes. */
  private weekStarts(start: Date, end: Date): Date[] {
    const starts: Date[] = [];
    let cursor = mondayOf(start);
    const last = mondayOf(end);

    while (cursor <= last) {
      starts.push(cursor);
      cursor = addDays(cursor, 7);
    }

    return starts;
  }

  /**
   * The circle method: one round of pairings per entry, every team meeting
   * every other exactly once across the whole list.
   *
   * An odd number of teams gets a bye each round, which is why the pairs are
   * filtered rather than assumed — a league with 11 teams has one team idle
   * every week, and that is a real schedule, not an error.
   */
  private roundRobin(teamIds: number[]): [number, number][][] {
    const ids = [...teamIds];
    const bye = -1;
    if (ids.length % 2 === 1) ids.push(bye);

    const count = ids.length;
    const rounds: [number, number][][] = [];

    // The first team stays put and the rest rotate around it, which is what
    // makes every team meet every other in count - 1 rounds.
    const rotating = ids.slice(1);

    for (let round = 0; round < count - 1; round += 1) {
      const order = [ids[0], ...rotating];
      const pairs: [number, number][] = [];

      for (let i = 0; i < count / 2; i += 1) {
        const home = order[i];
        const away = order[count - 1 - i];
        if (home !== bye && away !== bye) pairs.push([home, away]);
      }

      rounds.push(pairs);
      rotating.unshift(rotating.pop() as number);
    }

    return rounds;
  }

  /**
   * Which week we are in, for the screens that say "Week 12".
   *
   * The live week when one is running, otherwise the last one that finished,
   * so an off-season page says 23 rather than nothing.
   */
  async currentWeek(leagueId: number, seasonStartYear: number) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const live = await this.prisma.scheduleWeek.findFirst({
      where: {
        leagueId,
        seasonStartYear,
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });
    if (live) return live;

    return this.prisma.scheduleWeek.findFirst({
      where: { leagueId, seasonStartYear, endDate: { lt: today } },
      orderBy: { weekNumber: 'desc' },
    });
  }

  async weeks(leagueId: number, seasonStartYear: number) {
    return this.prisma.scheduleWeek.findMany({
      where: { leagueId, seasonStartYear },
      orderBy: { weekNumber: 'asc' },
    });
  }

  /** `MatchupStatus` for a week, from the calendar alone. */
  statusFor(week: { startDate: Date; endDate: Date; isSettled: boolean }) {
    if (week.isSettled) return MatchupStatus.final;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (week.startDate <= today && week.endDate >= today) {
      return MatchupStatus.live;
    }
    return MatchupStatus.upcoming;
  }
}
