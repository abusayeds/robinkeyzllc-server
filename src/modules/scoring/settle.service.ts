import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  Conference,
  LeaguePlayerStatus,
  MatchupStatus,
  PlayoffRound,
  Prisma,
  RosterSlotType,
  WeekPhase,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMPTY_TOTALS,
  type StatTotals,
  scoreMatchup,
  sumTotals,
  weeklyPoints,
} from './scoring.rules';
import { PLAYOFF_TEAMS_PER_CONFERENCE } from './schedule.service';
import { StandingsService } from './standings.service';

/**
 * Which players score.
 *
 * There is no lineup in AVORA — the commissioner sets how many of each slot a
 * roster holds, but no screen anywhere assigns a player to one, and
 * `pregameLockMinutes` says in its own comment that enforcing it needs game
 * times nobody enters. So the whole active roster scores, and the two slots
 * that are not active do not: an injured-reserve player is on the roster
 * precisely because he is not playing, and a two-way player does not count
 * toward the roster minimum either (Rule 4.8).
 */
const SCORING_SLOT = RosterSlotType.standard;

@Injectable()
export class SettleService {
  private readonly logger = new Logger(SettleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly standingsService: StandingsService,
  ) {}

  /**
   * Works out a week's results and writes them down.
   *
   * Written down rather than worked out on demand, for the same reason a trade
   * stores its own checks: a player traded in March must not move the points
   * he scored in December. Once a week is settled nothing recomputes it.
   *
   * Safe to run again on an already-settled week only through `force`, which
   * is there for a corrected box score — balldontlie does revise a line
   * occasionally — and not for ordinary use.
   */
  async settleWeek(leagueId: number, weekId: number, force = false) {
    const week = await this.prisma.scheduleWeek.findFirst({
      where: { id: weekId, leagueId },
      include: {
        matchups: {
          select: {
            id: true,
            homeTeamId: true,
            awayTeamId: true,
            playoffRound: true,
            playoffConference: true,
          },
        },
      },
    });
    if (!week) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Week not found');
    }

    if (week.isSettled && !force) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `Week ${week.weekNumber} is already settled.`,
      );
    }

    const totalsByTeam = await this.weekTotals(
      leagueId,
      week.startDate,
      week.endDate,
    );

    // Weekly points rank every team against every other, so they can only be
    // worked out once the whole league's totals are in — never per matchup.
    const points = weeklyPoints(
      [...totalsByTeam.entries()].map(([teamId, value]) => ({
        teamId,
        totals: value.totals,
      })),
    );

    await this.prisma.$transaction(async (tx) => {
      for (const matchup of week.matchups) {
        // A playoff round whose teams are not known yet is left alone.
        if (!matchup.homeTeamId || !matchup.awayTeamId) continue;

        const home = totalsByTeam.get(matchup.homeTeamId);
        const away = totalsByTeam.get(matchup.awayTeamId);
        const homeTotals = home?.totals ?? EMPTY_TOTALS;
        const awayTotals = away?.totals ?? EMPTY_TOTALS;

        const result = scoreMatchup(homeTotals, awayTotals);

        await tx.matchup.update({
          where: { id: matchup.id },
          data: {
            status: MatchupStatus.final,
            homeCategoryWins: result.homeCategoryWins,
            awayCategoryWins: result.awayCategoryWins,
            tiedCategories: result.tiedCategories,
            winnerTeamId:
              result.winner === 'home'
                ? matchup.homeTeamId
                : result.winner === 'away'
                  ? matchup.awayTeamId
                  : null,
          },
        });

        await this.writeTeamStat(tx, matchup.id, matchup.homeTeamId, {
          totals: homeTotals,
          categoryWins: result.homeCategoryWins,
          weekPoints: points.get(matchup.homeTeamId) ?? 0,
          playerCount: home?.playerCount ?? 0,
          gamesPlayed: home?.gamesPlayed ?? 0,
        });

        await this.writeTeamStat(tx, matchup.id, matchup.awayTeamId, {
          totals: awayTotals,
          categoryWins: result.awayCategoryWins,
          weekPoints: points.get(matchup.awayTeamId) ?? 0,
          playerCount: away?.playerCount ?? 0,
          gamesPlayed: away?.gamesPlayed ?? 0,
        });
      }

      await tx.scheduleWeek.update({
        where: { id: week.id },
        data: { isSettled: true, settledAt: new Date() },
      });
    });

    // Filling the next round is a separate step on purpose: it reads the
    // results this settle has just committed.
    const advanced = await this.advance(leagueId, week.seasonStartYear);

    return {
      weekNumber: week.weekNumber,
      phase: week.phase,
      matchupsSettled: week.matchups.filter((m) => m.homeTeamId && m.awayTeamId)
        .length,
      advanced,
    };
  }

  /** Every week that has ended and has not been settled, oldest first. */
  async settleDue(leagueId: number, seasonStartYear: number) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const due = await this.prisma.scheduleWeek.findMany({
      where: {
        leagueId,
        seasonStartYear,
        isSettled: false,
        endDate: { lt: today },
      },
      orderBy: { weekNumber: 'asc' },
      select: { id: true, weekNumber: true },
    });

    const settled: number[] = [];
    for (const week of due) {
      await this.settleWeek(leagueId, week.id);
      settled.push(week.weekNumber);
    }

    return { settled };
  }

  /**
   * One team's nine-category totals for a date range.
   *
   * The roster is read as it stands now. In normal running that is the right
   * answer, because a week is settled the day after it ends — and the result
   * is then frozen, so a later trade cannot disturb it. Settling a week weeks
   * late would credit today's roster, which is the one case where the snapshot
   * is only as good as the moment it was taken.
   */
  private async weekTotals(leagueId: number, from: Date, to: Date) {
    const roster = await this.prisma.leaguePlayer.findMany({
      where: {
        leagueId,
        teamId: { not: null },
        status: LeaguePlayerStatus.rostered,
        slotType: SCORING_SLOT,
      },
      select: { playerId: true, teamId: true },
    });

    const byTeam = new Map<
      number,
      { totals: StatTotals; playerCount: number; gamesPlayed: number }
    >();

    const teams = await this.prisma.team.findMany({
      where: { leagueId },
      select: { id: true },
    });
    for (const team of teams) {
      byTeam.set(team.id, {
        totals: EMPTY_TOTALS,
        playerCount: 0,
        gamesPlayed: 0,
      });
    }

    if (roster.length === 0) return byTeam;

    const lines = await this.prisma.playerGameStat.findMany({
      where: {
        playerId: { in: roster.map((row) => row.playerId) },
        gameDate: { gte: from, lte: to },
      },
      select: {
        playerId: true,
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
    });

    const teamByPlayerId = new Map(
      roster.map((row) => [row.playerId, row.teamId as number]),
    );

    const grouped = new Map<number, StatTotals[]>();
    const playersWhoPlayed = new Map<number, Set<number>>();

    for (const line of lines) {
      const teamId = teamByPlayerId.get(line.playerId);
      if (!teamId) continue;

      const list = grouped.get(teamId) ?? [];
      list.push(line);
      grouped.set(teamId, list);

      const players = playersWhoPlayed.get(teamId) ?? new Set<number>();
      players.add(line.playerId);
      playersWhoPlayed.set(teamId, players);
    }

    for (const [teamId, list] of grouped) {
      byTeam.set(teamId, {
        totals: sumTotals(list),
        playerCount: playersWhoPlayed.get(teamId)?.size ?? 0,
        gamesPlayed: list.length,
      });
    }

    return byTeam;
  }

  private async writeTeamStat(
    tx: Prisma.TransactionClient,
    matchupId: number,
    teamId: number,
    input: {
      totals: StatTotals;
      categoryWins: number;
      weekPoints: number;
      playerCount: number;
      gamesPlayed: number;
    },
  ) {
    const data = {
      fgm: input.totals.fgm,
      fga: input.totals.fga,
      ftm: input.totals.ftm,
      fta: input.totals.fta,
      fg3m: input.totals.fg3m,
      pts: input.totals.pts,
      reb: input.totals.reb,
      ast: input.totals.ast,
      stl: input.totals.stl,
      blk: input.totals.blk,
      turnover: input.totals.turnover,
      categoryWins: input.categoryWins,
      weekPoints: input.weekPoints,
      playerCount: input.playerCount,
      gamesPlayed: input.gamesPlayed,
    };

    await tx.matchupTeamStat.upsert({
      where: { matchupId_teamId: { matchupId, teamId } },
      create: { matchupId, teamId, ...data },
      update: data,
    });
  }

  /**
   * Fills whichever playoff slots are now known.
   *
   * Run after every settle rather than only after the last regular week,
   * because it is the one piece of logic that has to notice three different
   * moments: the regular season ending, the semifinals ending, and the
   * conference finals ending. Asking "what can be filled in now?" each time
   * answers all three without a calendar.
   */
  private async advance(leagueId: number, seasonStartYear: number) {
    const filled: string[] = [];

    const bracket = await this.prisma.matchup.findMany({
      where: {
        leagueId,
        playoffRound: { not: null },
        week: { seasonStartYear },
      },
      select: {
        id: true,
        playoffRound: true,
        playoffConference: true,
        homeSeed: true,
        awaySeed: true,
        homeTeamId: true,
        awayTeamId: true,
        winnerTeamId: true,
        homeCategoryWins: true,
        awayCategoryWins: true,
      },
    });
    if (bracket.length === 0) return filled;

    const regularDone = await this.regularSeasonComplete(
      leagueId,
      seasonStartYear,
    );

    // Semifinals: seeded off the regular-season table, once it is complete.
    const semis = bracket.filter(
      (row) => row.playoffRound === PlayoffRound.semifinal,
    );
    if (regularDone && semis.some((row) => !row.homeTeamId)) {
      const table = await this.standingsService.table(leagueId);

      for (const conference of [Conference.east, Conference.west]) {
        const qualified = table
          .filter((row) => row.conferenceKey === conference)
          .slice(0, PLAYOFF_TEAMS_PER_CONFERENCE);

        for (const matchup of semis.filter(
          (row) => row.playoffConference === conference,
        )) {
          const home = qualified[(matchup.homeSeed ?? 1) - 1];
          const away = qualified[(matchup.awaySeed ?? 4) - 1];
          if (!home || !away) continue;

          await this.prisma.matchup.update({
            where: { id: matchup.id },
            data: { homeTeamId: home.id, awayTeamId: away.id },
          });
          filled.push(
            `${conference} semifinal ${matchup.homeSeed}v${matchup.awaySeed}`,
          );
        }
      }
    }

    // Conference finals: the better seed is at home, which is the only thing
    // that decides a side once both teams are known.
    for (const conference of [Conference.east, Conference.west]) {
      const final = bracket.find(
        (row) =>
          row.playoffRound === PlayoffRound.conferenceFinal &&
          row.playoffConference === conference,
      );
      if (!final || final.homeTeamId) continue;

      const winners = semis
        .filter((row) => row.playoffConference === conference)
        .sort((a, b) => (a.homeSeed ?? 9) - (b.homeSeed ?? 9))
        .map((row) => ({
          teamId: row.winnerTeamId,
          seed: this.seedOfWinner(row),
        }));

      if (winners.length < 2 || winners.some((w) => !w.teamId)) continue;

      const [first, second] = winners.sort((a, b) => a.seed - b.seed);
      await this.prisma.matchup.update({
        where: { id: final.id },
        data: {
          homeTeamId: first.teamId,
          awayTeamId: second.teamId,
          homeSeed: first.seed,
          awaySeed: second.seed,
        },
      });
      filled.push(`${conference} conference final`);
    }

    // Championship: east at home, arbitrarily but consistently, because there
    // is no shared table to compare the two conference champions on.
    const championship = bracket.find(
      (row) => row.playoffRound === PlayoffRound.championship,
    );
    if (championship && !championship.homeTeamId) {
      const east = bracket.find(
        (row) =>
          row.playoffRound === PlayoffRound.conferenceFinal &&
          row.playoffConference === Conference.east,
      );
      const west = bracket.find(
        (row) =>
          row.playoffRound === PlayoffRound.conferenceFinal &&
          row.playoffConference === Conference.west,
      );

      if (east?.winnerTeamId && west?.winnerTeamId) {
        await this.prisma.matchup.update({
          where: { id: championship.id },
          data: {
            homeTeamId: east.winnerTeamId,
            awayTeamId: west.winnerTeamId,
          },
        });
        filled.push('championship');
      }
    }

    return filled;
  }

  /** Which seed won a semifinal, for seeding the round after it. */
  private seedOfWinner(matchup: {
    homeTeamId: number | null;
    awayTeamId: number | null;
    winnerTeamId: number | null;
    homeSeed: number | null;
    awaySeed: number | null;
  }) {
    if (matchup.winnerTeamId === matchup.homeTeamId) {
      return matchup.homeSeed ?? 9;
    }
    return matchup.awaySeed ?? 9;
  }

  private async regularSeasonComplete(
    leagueId: number,
    seasonStartYear: number,
  ) {
    const open = await this.prisma.scheduleWeek.count({
      where: {
        leagueId,
        seasonStartYear,
        phase: WeekPhase.regular,
        isSettled: false,
      },
    });
    return open === 0;
  }
}
