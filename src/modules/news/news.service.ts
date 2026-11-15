import { HttpStatus, Injectable } from '@nestjs/common';
import {
  LeaguePlayerStatus,
  NewsItemTier,
  NewsItemType,
  NotificationType,
} from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { excerptOf, type NewsPayload } from './news.breaking';

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
  /**
   * Set on a transaction post, which carries the Breaking News label and a
   * laid-out detail. An injury or a calendar date has none: those are not
   * transactions and nothing moved.
   */
  breaking: {
    itemId: number;
    type: NewsItemType;
    tier: NewsItemTier;
    payload: NewsPayload;
  } | null;
};

/** Which heading on the page a transaction post belongs under. */
const CATEGORY_OF: Record<NewsItemType, NewsCategory> = {
  trade: 'Trade',
  veto: 'Trade',
  signing: 'Signing',
  extension: 'Signing',
  offerSheet: 'Signing',
  waiver: 'Waiver',
  claim: 'Waiver',
  draftPick: 'Draft',
};

const LIMIT = 40;

/** Injury statuses that are worth shouting about. */
const SERIOUS = ['out', 'out for season'];

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One post, with its neighbours.
   *
   * Prev and next come back with it so the detail page can offer them without
   * loading the whole feed to work out where it sits.
   */
  async item(leagueId: number, itemId: number) {
    const post = await this.prisma.leagueNewsItem.findFirst({
      where: { id: itemId, leagueId },
    });
    if (!post) {
      throw new AppError(HttpStatus.NOT_FOUND, 'That news item was not found.');
    }

    const [previous, next] = await Promise.all([
      this.prisma.leagueNewsItem.findFirst({
        where: { leagueId, createdAt: { lt: post.createdAt } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, autoHeadline: true, customHeadline: true },
      }),
      this.prisma.leagueNewsItem.findFirst({
        where: { leagueId, createdAt: { gt: post.createdAt } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, autoHeadline: true, customHeadline: true },
      }),
    ]);

    const payload = post.payload as unknown as NewsPayload;
    const neighbour = (
      row: {
        id: number;
        autoHeadline: string;
        customHeadline: string | null;
      } | null,
    ) =>
      row
        ? { id: row.id, headline: row.customHeadline ?? row.autoHeadline }
        : null;

    return {
      id: post.id,
      type: post.type,
      tier: post.tier,
      headline: post.customHeadline ?? post.autoHeadline,
      autoHeadline: post.autoHeadline,
      customHeadline: post.customHeadline,
      category: CATEGORY_OF[post.type],
      excerpt: excerptOf(post.type, payload),
      payload,
      createdAt: post.createdAt.toISOString(),
      previous: neighbour(previous),
      next: neighbour(next),
    };
  }

  /**
   * Rule-free editorial control: a commissioner may replace a generated
   * headline. Clearing it falls back to the generated one rather than leaving
   * the post untitled.
   */
  async setHeadline(leagueId: number, itemId: number, headline: string | null) {
    const post = await this.prisma.leagueNewsItem.findFirst({
      where: { id: itemId, leagueId },
      select: { id: true },
    });
    if (!post) {
      throw new AppError(HttpStatus.NOT_FOUND, 'That news item was not found.');
    }

    await this.prisma.leagueNewsItem.update({
      where: { id: post.id },
      data: { customHeadline: headline?.trim() || null },
    });

    return this.item(leagueId, itemId);
  }

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

    const [posts, injuries, announcements, dates] = await Promise.all([
      // Transactions now write their own post when they happen, with the cap
      // figures as they were at the time. The transactions feed is no longer
      // read for them: it describes a move in one line and cannot say which
      // team got whom.
      this.prisma.leagueNewsItem.findMany({
        where: { leagueId },
        orderBy: { createdAt: 'desc' },
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

    for (const post of posts) {
      const payload = post.payload as unknown as NewsPayload;
      items.push({
        id: `news-${post.id}`,
        category: CATEGORY_OF[post.type],
        // The commissioner's own headline wins; otherwise the one built from
        // the data when the post was written.
        headline: post.customHeadline ?? post.autoHeadline,
        excerpt: excerptOf(post.type, payload),
        body: excerptOf(post.type, payload),
        timestamp: post.createdAt.toISOString(),
        tags: [CATEGORY_OF[post.type]],
        teams: payload.teams.map((team) => team.name),
        players: payload.teams.flatMap((team) =>
          team.players.map((player) => player.name),
        ),
        alert: false,
        breaking: {
          itemId: post.id,
          type: post.type,
          tier: post.tier,
          payload,
        },
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
        breaking: null,
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
        breaking: null,
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
        breaking: null,
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
