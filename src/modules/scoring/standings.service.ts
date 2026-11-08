import { HttpStatus, Injectable } from '@nestjs/common';
import { Conference, PlayoffRound, WeekPhase } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import {
  CATEGORIES,
  EMPTY_TOTALS,
  categoryValues,
  lastNRecord,
  streak,
  sumTotals,
  type StatTotals,
} from './scoring.rules';

/** The standings table's L10 column. Ten weeks, not ten games. */
const RECENT_WEEKS = 10;

const CONFERENCE_LABEL: Record<Conference, 'East' | 'West'> = {
  east: 'East',
  west: 'West',
};

const ROUND_LABEL: Record<PlayoffRound, string> = {
  semifinal: 'Semifinal',
  conferenceFinal: 'Conference Final',
  championship: 'Championship',
};

type Outcome = 'W' | 'L' | 'T';

export type StandingsRow = {
  id: number;
  team: string;
  abbr: string;
  logo: string | null;
  color: string;
  conference: 'East' | 'West';
  /** The enum value, for callers that group rather than display. */
  conferenceKey: Conference;
  w: number;
  l: number;
  t: number;
  /** Record inside the team's own division, or its conference when it has none. */
  div: string;
  l10: string;
  streak: string;
  /** Categories taken all season. The screen's PF. */
  ptsFor: number;
  /** Categories given up. PA. */
  ptsAgainst: number;
};

@Injectable()
export class StandingsService {
  constructor(private readonly prisma: PrismaService) {}

  async seasonOf(leagueId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { season: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }
    return {
      season: league.season,
      seasonStartYear:
        parseSeasonLabel(league.season) ?? new Date().getUTCFullYear(),
    };
  }

  /**
   * The standings table, in order.
   *
   * Worked out from the settled matchups rather than kept in a column of its
   * own: a record is nothing but a count of results, and a second copy of it
   * is a second thing that can be wrong. Twenty-odd weeks of a dozen teams is
   * a few hundred rows.
   */
  async table(leagueId: number, forSeason?: number) {
    // Callers inside this module already know the year; the settle service
    // does not, so it is looked up rather than demanded.
    const seasonStartYear =
      forSeason ?? (await this.seasonOf(leagueId)).seasonStartYear;

    const [teams, matchups] = await Promise.all([
      this.prisma.team.findMany({
        where: { leagueId },
        select: {
          id: true,
          name: true,
          abbr: true,
          logo: true,
          color: true,
          conference: true,
          division: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.matchup.findMany({
        where: {
          leagueId,
          homeTeamId: { not: null },
          awayTeamId: { not: null },
          // Only settled regular-season weeks count. A playoff result is in
          // the bracket, not in the table.
          week: {
            seasonStartYear,
            phase: WeekPhase.regular,
            isSettled: true,
          },
        },
        orderBy: { week: { weekNumber: 'asc' } },
        select: {
          homeTeamId: true,
          awayTeamId: true,
          homeCategoryWins: true,
          awayCategoryWins: true,
          winnerTeamId: true,
          tiedCategories: true,
        },
      }),
    ]);

    const divisionOf = new Map(
      teams.map((team) => [
        team.id,
        // A league with no divisions still has a Div column to fill, and the
        // conference is the only other grouping there is.
        team.division?.trim() || `conference:${team.conference}`,
      ]),
    );

    type Tally = {
      w: number;
      l: number;
      t: number;
      ptsFor: number;
      ptsAgainst: number;
      divWins: number;
      divLosses: number;
      results: Outcome[];
    };

    const tally = new Map<number, Tally>(
      teams.map((team) => [
        team.id,
        {
          w: 0,
          l: 0,
          t: 0,
          ptsFor: 0,
          ptsAgainst: 0,
          divWins: 0,
          divLosses: 0,
          results: [],
        },
      ]),
    );

    for (const matchup of matchups) {
      const homeId = matchup.homeTeamId as number;
      const awayId = matchup.awayTeamId as number;
      const home = tally.get(homeId);
      const away = tally.get(awayId);
      if (!home || !away) continue;

      const sameDivision = divisionOf.get(homeId) === divisionOf.get(awayId);

      const homeOutcome: Outcome =
        matchup.winnerTeamId === homeId
          ? 'W'
          : matchup.winnerTeamId === awayId
            ? 'L'
            : 'T';
      const awayOutcome: Outcome =
        homeOutcome === 'W' ? 'L' : homeOutcome === 'L' ? 'W' : 'T';

      for (const [side, outcome, forWins, againstWins] of [
        [home, homeOutcome, matchup.homeCategoryWins, matchup.awayCategoryWins],
        [away, awayOutcome, matchup.awayCategoryWins, matchup.homeCategoryWins],
      ] as const) {
        if (outcome === 'W') side.w += 1;
        else if (outcome === 'L') side.l += 1;
        else side.t += 1;

        side.ptsFor += forWins;
        side.ptsAgainst += againstWins;

        if (sameDivision) {
          if (outcome === 'W') side.divWins += 1;
          else if (outcome === 'L') side.divLosses += 1;
        }

        // Newest first, which is the order a streak and an L10 are read in.
        side.results.unshift(outcome);
      }
    }

    const rows: StandingsRow[] = teams.map((team) => {
      const row = tally.get(team.id) as Tally;
      return {
        id: team.id,
        team: team.name,
        abbr: team.abbr,
        logo: team.logo,
        color: team.color,
        conference: CONFERENCE_LABEL[team.conference],
        conferenceKey: team.conference,
        w: row.w,
        l: row.l,
        t: row.t,
        div: `${row.divWins}-${row.divLosses}`,
        l10: lastNRecord(row.results, RECENT_WEEKS),
        streak: streak(row.results),
        ptsFor: row.ptsFor,
        ptsAgainst: row.ptsAgainst,
      };
    });

    return rows.sort((a, b) => b.w - a.w || a.l - b.l || b.ptsFor - a.ptsFor);
  }

  /**
   * Category totals over a range of weeks.
   *
   * Re-totalled from the stored makes and attempts, never from stored
   * percentages, so "weeks 1-12" is the twelve weeks' shooting rather than an
   * average of twelve percentages (see `scoring.rules.ts`).
   */
  async categoryTotals(
    leagueId: number,
    seasonStartYear: number,
    filter: { weekNumber?: number; from?: Date; to?: Date } = {},
  ) {
    const weekWhere: {
      seasonStartYear: number;
      isSettled: boolean;
      weekNumber?: number;
      startDate?: { gte: Date };
      endDate?: { lte: Date };
    } = { seasonStartYear, isSettled: true };

    if (filter.weekNumber) weekWhere.weekNumber = filter.weekNumber;
    if (filter.from) weekWhere.startDate = { gte: filter.from };
    if (filter.to) weekWhere.endDate = { lte: filter.to };

    const stats = await this.prisma.matchupTeamStat.findMany({
      where: { matchup: { leagueId, week: weekWhere } },
      select: {
        teamId: true,
        fgm: true,
        fga: true,
        ftm: true,
        fta: true,
        fg3m: true,
        pts: true,
        reb: true,
        ast: true,
        stl: true,
        blk: true,
        turnover: true,
        categoryWins: true,
        weekPoints: true,
      },
    });

    const byTeam = new Map<
      number,
      { lines: StatTotals[]; weekPoints: number; categoryWins: number }
    >();

    for (const row of stats) {
      const entry = byTeam.get(row.teamId) ?? {
        lines: [],
        weekPoints: 0,
        categoryWins: 0,
      };
      entry.lines.push(row);
      entry.weekPoints += row.weekPoints;
      entry.categoryWins += row.categoryWins;
      byTeam.set(row.teamId, entry);
    }

    const teams = await this.prisma.team.findMany({
      where: { leagueId },
      select: { id: true },
    });

    return teams.map((team) => {
      const entry = byTeam.get(team.id);
      const totals = entry ? sumTotals(entry.lines) : EMPTY_TOTALS;
      const values = categoryValues(totals);

      return {
        teamId: team.id,
        // Rounded to the one decimal place the table shows, so the number the
        // screen prints is the number the comparison used.
        fgPct: Math.round(values.fgPct * 10) / 10,
        ftPct: Math.round(values.ftPct * 10) / 10,
        threes: values.threes,
        pts: values.pts,
        reb: values.reb,
        ast: values.ast,
        stl: values.stl,
        blk: values.blk,
        to: values.to,
        weekPoints: entry?.weekPoints ?? 0,
        categoryWins: entry?.categoryWins ?? 0,
      };
    });
  }

  /** Head-to-head wins per team, the season table's own first column. */
  async h2hWins(leagueId: number, seasonStartYear: number) {
    const rows = await this.table(leagueId, seasonStartYear);
    return new Map(rows.map((row) => [row.id, row.w]));
  }

  /**
   * The bracket, in the shape the design draws it: three rounds, four teams a
   * conference, and "TBD" wherever a slot is not filled yet.
   */
  async playoffs(leagueId: number, seasonStartYear: number, season: string) {
    const matchups = await this.prisma.matchup.findMany({
      where: {
        leagueId,
        playoffRound: { not: null },
        week: { seasonStartYear },
      },
      orderBy: [{ playoffRound: 'asc' }, { homeSeed: 'asc' }],
      select: {
        id: true,
        playoffRound: true,
        playoffConference: true,
        homeSeed: true,
        awaySeed: true,
        homeCategoryWins: true,
        awayCategoryWins: true,
        winnerTeamId: true,
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
        week: {
          select: {
            weekNumber: true,
            startDate: true,
            endDate: true,
            isSettled: true,
          },
        },
      },
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const series = matchups.map((row) => ({
      id: String(row.id),
      round: ROUND_LABEL[row.playoffRound as PlayoffRound],
      // The championship belongs to neither conference, and the bracket reads
      // that slot as 'Final'.
      conference: row.playoffConference
        ? CONFERENCE_LABEL[row.playoffConference]
        : ('Final' as const),
      home: row.homeTeam
        ? {
            seed: row.homeSeed ?? 0,
            team: row.homeTeam.name,
            teamId: row.homeTeam.id,
          }
        : undefined,
      away: row.awayTeam
        ? {
            seed: row.awaySeed ?? 0,
            team: row.awayTeam.name,
            teamId: row.awayTeam.id,
          }
        : undefined,
      homeWins: row.homeCategoryWins,
      awayWins: row.awayCategoryWins,
      winnerId: row.winnerTeamId ?? undefined,
      live:
        !row.week.isSettled &&
        row.week.startDate <= today &&
        row.week.endDate >= today,
    }));

    return {
      title: `${season} Dynasty Playoffs`,
      statusLabel: this.playoffStatus(series),
      series,
    };
  }

  /** What the chip beside the bracket's title says. */
  private playoffStatus(
    series: {
      round: string;
      live: boolean;
      winnerId?: number;
      home?: unknown;
    }[],
  ) {
    const live = series.find((row) => row.live);
    if (live) return `${live.round}s in Progress`;

    const champion = series.find(
      (row) => row.round === 'Championship' && row.winnerId,
    );
    if (champion) return 'Champion Crowned';

    const drawn = series.some((row) => row.home);
    return drawn ? 'Bracket Set' : 'Awaiting Qualification';
  }

  /** The nine categories, so the client never has to hold its own copy. */
  categories() {
    return CATEGORIES;
  }
}
