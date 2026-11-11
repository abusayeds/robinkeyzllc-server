import { HttpStatus, Injectable } from '@nestjs/common';
import { LeaguePlayerStatus, NotificationType } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';

/**
 * The league's news feed.
 *
 * AVORA has no editorial desk, so there is nothing to write articles into.
 * What it does have is four streams of things that have actually happened, and
 * every category the screen names maps onto one of them:
 *
 * - Trade, Signing, Waiver, Draft → the transactions feed
 * - Injury                        → the nightly balldontlie injury pull
 * - Commissioner                  → announcements sent to the league
 * - League Update                 → dates on the league calendar
 *
 * Nothing here is generated. An item exists because a move was processed, a
 * player got hurt, or somebody wrote it.
 */

export type NewsCategory =
  | 'Trade'
  | 'Signing'
  | 'Waiver'
  | 'Injury'
  | 'Commissioner'
  | 'Draft'
  | 'League Update';

export type NewsArticle = {
  id: string;
  category: NewsCategory;
  headline: string;
  excerpt: string;
  body: string;
  timestamp: string;
  tags: string[];
  teams: string[];
  players: string[];
  /** Worth a coloured bar: an injury, or a date that is running now. */
  alert: boolean;
};

const LIMIT = 40;

/** Injury statuses that are worth shouting about. */
const SERIOUS = ['out', 'out for season'];

@Injectable()
export class NewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async feed(leagueId: number, userId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { id: true, name: true, season: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }

    const membership = await this.prisma.teamMember.findFirst({
      where: { leagueId, userId },
      select: { teamId: true },
    });

    const [moves, injuries, announcements, dates] = await Promise.all([
      this.transactionsService.feed(leagueId, {
        teamId: membership?.teamId ?? null,
        take: LIMIT,
      }),
      // Only players this league rosters. An injury to somebody nobody owns is
      // not this league's news.
      this.prisma.playerInjury.findMany({
        orderBy: { updatedAt: 'desc' },
        take: LIMIT,
        where: {
          player: {
            leaguePlayers: {
              some: {
                leagueId,
                teamId: { not: null },
                status: LeaguePlayerStatus.rostered,
              },
            },
          },
        },
        select: {
          id: true,
          status: true,
          description: true,
          returnDate: true,
          updatedAt: true,
          player: {
            select: {
              name: true,
              leaguePlayers: {
                where: { leagueId },
                select: { team: { select: { name: true } } },
                take: 1,
              },
            },
          },
        },
      }),
      this.prisma.notification.findMany({
        // An announcement is sent to every member, so each has their own
        // row. The viewer's copy is the one to show — reading all of them
        // would print the same notice once per member.
        where: { leagueId, userId, type: NotificationType.announcement },
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
        select: {
          id: true,
          title: true,
          detail: true,
          createdAt: true,
        },
      }),
      this.prisma.leagueCalendarEvent.findMany({
        where: { leagueId, season: league.season },
        orderBy: { startDate: 'desc' },
        take: LIMIT,
        select: {
          id: true,
          title: true,
          description: true,
          phase: true,
          startDate: true,
          endDate: true,
        },
      }),
    ]);

    const items: NewsArticle[] = [];

    for (const move of moves) {
      // The four move categories the screen names, from the one it carries.
      const category: NewsCategory =
        move.type === 'Player Waived'
          ? 'Waiver'
          : move.type === 'Draft Pick Traded'
            ? 'Draft'
            : move.category === 'Signings'
              ? 'Signing'
              : 'Trade';

      items.push({
        id: `move-${move.id}`,
        category,
        headline: move.teams ? `${move.type} — ${move.teams}` : move.type,
        excerpt: move.description,
        body: move.description,
        timestamp: move.date,
        tags: [category],
        teams: move.teams ? move.teams.split(/ ↔ | → /) : [],
        players: [],
        alert: false,
      });
    }

    for (const injury of injuries) {
      const team = injury.player.leaguePlayers[0]?.team?.name ?? null;
      const returning = injury.returnDate
        ? ` Expected back ${injury.returnDate.toISOString().slice(0, 10)}.`
        : '';

      items.push({
        id: `injury-${injury.id}`,
        category: 'Injury',
        headline: `${injury.player.name} — ${injury.status}`,
        excerpt: injury.description ?? injury.status,
        body: `${injury.description ?? injury.status}${returning}`,
        timestamp: injury.updatedAt.toISOString(),
        tags: ['Injury', injury.status],
        teams: team ? [team] : [],
        players: [injury.player.name],
        alert: SERIOUS.includes(injury.status.toLowerCase()),
      });
    }

    for (const notice of announcements) {
      items.push({
        id: `notice-${notice.id}`,
        category: 'Commissioner',
        headline: notice.title,
        excerpt: notice.detail,
        body: notice.detail,
        timestamp: notice.createdAt.toISOString(),
        tags: ['Commissioner'],
        teams: [],
        players: [],
        alert: false,
      });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (const event of dates) {
      const end = event.endDate ?? event.startDate;
      // A date still in the future is on the calendar, not in the news.
      if (event.startDate > today) continue;

      items.push({
        id: `date-${event.id}`,
        category: 'League Update',
        headline: event.title,
        excerpt: event.description || `${league.name} calendar`,
        body: event.description || `${league.name} calendar`,
        timestamp: event.startDate.toISOString(),
        tags: ['League Update', event.phase],
        teams: [],
        players: [],
        alert: event.startDate <= today && end >= today,
      });
    }

    const articles = items
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, LIMIT);

    return {
      league: { id: league.id, name: league.name, season: league.season },
      myTeamId: membership?.teamId ?? null,
      articles,
      // What the sidebar shows beside the feed.
      counts: articles.reduce<Record<string, number>>((counts, article) => {
        counts[article.category] = (counts[article.category] ?? 0) + 1;
        return counts;
      }, {}),
    };
  }
}
