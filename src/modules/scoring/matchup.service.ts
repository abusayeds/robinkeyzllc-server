import { HttpStatus, Injectable } from '@nestjs/common';
import { LeaguePlayerStatus, MatchupStatus } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CATEGORIES,
  EMPTY_TOTALS,
  categoryValues,
  scoreMatchup,
  sumTotals,
  type StatTotals,
} from './scoring.rules';
import { StandingsService } from './standings.service';

const SCORING_SLOT = 'standard' as const;

@Injectable()
export class MatchupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly standingsService: StandingsService,
  ) {}

  /**
   * Every matchup of a season, with each team's record attached.
   *
   * The schedule screen shows a card per matchup and a whole-season grid, and
   * both want the same rows — so they are served once rather than fetched per
   * week. A season is around 25 weeks of 6 matchups.
   */
  async list(leagueId: number, seasonStartYear: number) {
    const [matchups, standings] = await Promise.all([
      this.prisma.matchup.findMany({
        where: { leagueId, week: { seasonStartYear } },
        orderBy: [{ week: { weekNumber: 'asc' } }, { id: 'asc' }],
        select: {
          id: true,
          homeTeamId: true,
          awayTeamId: true,
          homeCategoryWins: true,
          awayCategoryWins: true,
          tiedCategories: true,
          winnerTeamId: true,
          playoffRound: true,
          playoffConference: true,
          week: {
            select: {
              weekNumber: true,
              startDate: true,
              endDate: true,
              isSettled: true,
              phase: true,
            },
          },
          // Both sides' totals, so the card can name the categories each
          // team took without a second request per matchup.
          teamStats: {
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
            },
          },
        },
      }),
      this.standingsService.table(leagueId, seasonStartYear),
    ]);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    return {
      teams: standings.map((row) => ({
        id: row.id,
        name: row.team,
        abbr: row.abbr,
        logo: row.logo,
        color: row.color,
        conference: row.conference,
        // What the card prints under the team name.
        record: `${row.w}-${row.l}${row.t > 0 ? `-${row.t}` : ''}`,
      })),
      matchups: matchups.map((row) => ({
        id: row.id,
        week: row.week.weekNumber,
        startDate: row.week.startDate,
        endDate: row.week.endDate,
        homeId: row.homeTeamId,
        awayId: row.awayTeamId,
        // The "score" of a nine-category week is the categories taken.
        homeScore: row.homeCategoryWins,
        awayScore: row.awayCategoryWins,
        tied: row.tiedCategories,
        winnerId: row.winnerTeamId,
        status: this.statusOf(row.week, today),
        phase: row.week.phase,
        playoffRound: row.playoffRound,
        playoffConference: row.playoffConference,
        ...this.wonCategoriesOf(row),
      })),
    };
  }

  /**
   * Which categories each side took, by name.
   *
   * Empty on an unsettled matchup: there is nothing to have taken yet, and
   * a running total belongs on the matchup's own screen rather than on a
   * card in a list.
   */
  private wonCategoriesOf(row: {
    homeTeamId: number | null;
    awayTeamId: number | null;
    week: { isSettled: boolean };
    teamStats: (StatTotals & { teamId: number })[];
  }) {
    const empty: { homeWonCategories: string[]; awayWonCategories: string[] } =
      {
        homeWonCategories: [],
        awayWonCategories: [],
      };
    if (!row.week.isSettled || !row.homeTeamId || !row.awayTeamId) {
      return empty;
    }

    const home = row.teamStats.find((s) => s.teamId === row.homeTeamId);
    const away = row.teamStats.find((s) => s.teamId === row.awayTeamId);
    if (!home || !away) return empty;

    const result = scoreMatchup(home, away);

    return {
      homeWonCategories: result.categories
        .filter((c) => c.homeWins === true)
        .map((c) => c.label),
      awayWonCategories: result.categories
        .filter((c) => c.homeWins === false)
        .map((c) => c.label),
    };
  }

  /**
   * One matchup in full: the nine categories side by side, and every player
   * line behind them.
   *
   * A settled week reads its categories from the stored snapshot, so what is
   * shown is what was scored. A live week is totalled from the lines on the
   * spot — nothing is written until the week ends, and a running score has to
   * come from somewhere.
   */
  async detail(leagueId: number, matchupId: number) {
    const matchup = await this.prisma.matchup.findFirst({
      where: { id: matchupId, leagueId },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        homeCategoryWins: true,
        awayCategoryWins: true,
        tiedCategories: true,
        winnerTeamId: true,
        playoffRound: true,
        playoffConference: true,
        week: {
          select: {
            weekNumber: true,
            startDate: true,
            endDate: true,
            isSettled: true,
            phase: true,
          },
        },
        teamStats: {
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
            playerCount: true,
            gamesPlayed: true,
          },
        },
      },
    });
    if (!matchup) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Matchup not found');
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const status = this.statusOf(matchup.week, today);

    const [homeSide, awaySide] = await Promise.all([
      this.side(
        leagueId,
        matchup.homeTeamId,
        matchup.week.startDate,
        matchup.week.endDate,
        matchup.teamStats.find((s) => s.teamId === matchup.homeTeamId) ?? null,
        matchup.week.isSettled,
      ),
      this.side(
        leagueId,
        matchup.awayTeamId,
        matchup.week.startDate,
        matchup.week.endDate,
        matchup.teamStats.find((s) => s.teamId === matchup.awayTeamId) ?? null,
        matchup.week.isSettled,
      ),
    ]);

    // Settled: the stored result, which is the one that counted. Live: worked
    // out now, because nothing has been written yet.
    const result = matchup.week.isSettled
      ? null
      : scoreMatchup(homeSide.totals, awaySide.totals);

    const homeValues = categoryValues(homeSide.totals);
    const awayValues = categoryValues(awaySide.totals);

    const categories = CATEGORIES.map((category, index) => ({
      key: category.key,
      label: category.label,
      percent: category.percent,
      lowerBetter: category.lowerBetter,
      home: Math.round(homeValues[category.key] * 10) / 10,
      away: Math.round(awayValues[category.key] * 10) / 10,
      homeWins: result
        ? result.categories[index].homeWins
        : this.storedWinner(category, homeValues, awayValues),
    }));

    return {
      id: matchup.id,
      week: matchup.week.weekNumber,
      startDate: matchup.week.startDate,
      endDate: matchup.week.endDate,
      status,
      phase: matchup.week.phase,
      playoffRound: matchup.playoffRound,
      playoffConference: matchup.playoffConference,
      homeScore: matchup.week.isSettled
        ? matchup.homeCategoryWins
        : (result?.homeCategoryWins ?? 0),
      awayScore: matchup.week.isSettled
        ? matchup.awayCategoryWins
        : (result?.awayCategoryWins ?? 0),
      tied: matchup.week.isSettled
        ? matchup.tiedCategories
        : (result?.tiedCategories ?? 0),
      winnerId: matchup.winnerTeamId,
      categories,
      home: homeSide.payload,
      away: awaySide.payload,
    };
  }

  /**
   * A settled matchup's category winner.
   *
   * Worked out from the stored totals rather than stored per category: nine
   * booleans a row would be nine more things to keep in step with the totals
   * beside them, and the same comparison gives the same answer.
   */
  private storedWinner(
    category: (typeof CATEGORIES)[number],
    home: Record<string, number>,
    away: Record<string, number>,
  ): boolean | null {
    const h = home[category.key];
    const a = away[category.key];
    const margin = category.percent ? 0.05 : 0;
    if (Math.abs(h - a) <= margin) return null;
    return category.lowerBetter ? h < a : h > a;
  }

  /**
   * One side of a matchup: its totals and its players' lines.
   *
   * A settled week's totals come from the snapshot and a live week's from the
   * lines, so the two can differ for a good reason — a player traded in since
   * the week ended is on the roster today but was not then, and the snapshot
   * remembers.
   */
  private async side(
    leagueId: number,
    teamId: number | null,
    from: Date,
    to: Date,
    stored: {
      fgm: number;
      fga: number;
      ftm: number;
      fta: number;
      fg3m: number;
      pts: number;
      reb: number;
      ast: number;
      stl: number;
      blk: number;
      turnover: number;
      categoryWins: number;
      weekPoints: number;
      playerCount: number;
      gamesPlayed: number;
    } | null,
    isSettled: boolean,
  ) {
    if (!teamId) {
      return {
        totals: EMPTY_TOTALS,
        payload: null,
      };
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        abbr: true,
        logo: true,
        color: true,
        // The screen names the manager beside the team, so the owner comes
        // along rather than being looked up again per side.
        members: {
          where: { role: 'owner' },
          select: { user: { select: { id: true, name: true } } },
          take: 1,
        },
      },
    });

    const roster = await this.prisma.leaguePlayer.findMany({
      where: {
        leagueId,
        teamId,
        status: LeaguePlayerStatus.rostered,
        slotType: SCORING_SLOT,
      },
      select: {
        playerId: true,
        player: {
          select: {
            id: true,
            name: true,
            position: true,
            headshot: true,
            nbaTeam: { select: { abbreviation: true } },
          },
        },
      },
    });

    const lines = roster.length
      ? await this.prisma.playerGameStat.groupBy({
          by: ['playerId'],
          where: {
            playerId: { in: roster.map((row) => row.playerId) },
            gameDate: { gte: from, lte: to },
          },
          _count: { _all: true },
          _sum: {
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
          },
        })
      : [];

    const byPlayerId = new Map(lines.map((row) => [row.playerId, row]));

    const players = roster
      .map((row) => {
        const line = byPlayerId.get(row.playerId);
        const sum = line?._sum;

        return {
          playerId: row.player.id,
          name: row.player.name,
          position: row.player.position,
          headshot: row.player.headshot,
          nbaTeam: row.player.nbaTeam?.abbreviation ?? null,
          games: line?._count._all ?? 0,
          fgm: sum?.fgm ?? 0,
          fga: sum?.fga ?? 0,
          ftm: sum?.ftm ?? 0,
          fta: sum?.fta ?? 0,
          threes: sum?.fg3m ?? 0,
          pts: sum?.pts ?? 0,
          reb: sum?.reb ?? 0,
          ast: sum?.ast ?? 0,
          stl: sum?.stl ?? 0,
          blk: sum?.blk ?? 0,
          to: sum?.turnover ?? 0,
        };
      })
      // Most productive first; a player who did not play drops to the bottom.
      .sort((a, b) => b.pts - a.pts || b.games - a.games);

    const live: StatTotals = sumTotals(
      lines.map((row) => ({
        fgm: row._sum.fgm ?? 0,
        fga: row._sum.fga ?? 0,
        ftm: row._sum.ftm ?? 0,
        fta: row._sum.fta ?? 0,
        fg3m: row._sum.fg3m ?? 0,
        pts: row._sum.pts ?? 0,
        reb: row._sum.reb ?? 0,
        ast: row._sum.ast ?? 0,
        stl: row._sum.stl ?? 0,
        blk: row._sum.blk ?? 0,
        turnover: row._sum.turnover ?? 0,
      })),
    );

    const totals: StatTotals = isSettled && stored ? stored : live;

    return {
      totals,
      payload: {
        team: team
          ? {
              id: team.id,
              name: team.name,
              abbr: team.abbr,
              logo: team.logo,
              color: team.color,
              owner: team.members[0]?.user ?? null,
            }
          : null,
        categoryWins: stored?.categoryWins ?? 0,
        weekPoints: stored?.weekPoints ?? 0,
        playerCount:
          stored?.playerCount ?? lines.filter((l) => l._count._all > 0).length,
        gamesPlayed:
          stored?.gamesPlayed ??
          lines.reduce((sum, l) => sum + l._count._all, 0),
        players,
      },
    };
  }

  private statusOf(
    week: { startDate: Date; endDate: Date; isSettled: boolean },
    today: Date,
  ): MatchupStatus {
    if (week.isSettled) return MatchupStatus.final;
    if (week.startDate <= today && week.endDate >= today) {
      return MatchupStatus.live;
    }
    return MatchupStatus.upcoming;
  }
}
