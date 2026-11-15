import { Injectable } from '@nestjs/common';
import {
  NewsItemSource,
  NewsItemType,
  NotificationType,
  Prisma,
  TradeAssetKind,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { pickLabel } from '../draft/draft.rules';
import {
  autoHeadline,
  type NewsPayload,
  type NewsTeamLeg,
} from './news.breaking';

/**
 * Writes League News posts.
 *
 * Called from wherever a move finishes, inside that move's own transaction, so
 * a trade that is rolled back never leaves a post behind. The unique pair of
 * source type and id means a retried approval cannot post the same news twice.
 */
@Injectable()
export class NewsPublisher {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One post, written once.
   *
   * `skipDuplicates` is not available on a single create, so the unique
   * constraint is caught instead: being asked twice is expected, not an error
   * worth failing a trade over.
   */
  private async write(
    tx: Prisma.TransactionClient,
    input: {
      leagueId: number;
      type: NewsItemType;
      sourceType: NewsItemSource;
      sourceId: number;
      payload: NewsPayload;
    },
  ) {
    const headline = autoHeadline(input.type, input.payload, input.sourceId);
    let item: { id: number } | null = null;
    try {
      item = await tx.leagueNewsItem.create({
        data: {
          leagueId: input.leagueId,
          type: input.type,
          autoHeadline: headline,
          payload: input.payload as unknown as Prisma.InputJsonValue,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
        select: { id: true },
      });
    } catch (error) {
      const known = error as { code?: string };
      if (known.code !== 'P2002') throw error;
      // Already posted. Nothing to announce a second time.
      return;
    }

    await this.announce(tx, input.leagueId, item.id, input.type, headline);
  }

  /**
   * The same post in the notification bell.
   *
   * One format everywhere: the bell carries the label and the headline, and
   * the link opens the post itself, so a member reads the same sentence
   * wherever they meet it. Never allowed to throw — a notification row must
   * not be able to roll back the move it is describing.
   */
  private async announce(
    tx: Prisma.TransactionClient,
    leagueId: number,
    itemId: number,
    type: NewsItemType,
    headline: string,
  ) {
    try {
      const members = await tx.leagueMember.findMany({
        where: { leagueId },
        select: { userId: true },
      });
      if (members.length === 0) return;

      await tx.notification.createMany({
        data: members.map((member) => ({
          userId: member.userId,
          // Every transaction post is league news; the bell groups them the
          // same way the page does.
          type:
            type === NewsItemType.trade || type === NewsItemType.veto
              ? NotificationType.tradeProposal
              : NotificationType.freeAgency,
          title: '🚨 BREAKING NEWS',
          detail: headline,
          leagueId,
          link: `/league/news/news-${itemId}`,
        })),
      });
    } catch {
      // Swallowed on purpose: see the note above.
    }
  }

  /**
   * A processed trade.
   *
   * The cap figures are read before anything moves and passed in, because
   * afterwards the payroll they describe has already changed.
   */
  async publishTrade(
    tx: Prisma.TransactionClient,
    input: {
      leagueId: number;
      tradeId: number;
      seasonStartYear: number;
      salaryCap: number;
      teams: {
        teamId: number;
        name: string;
        abbr: string;
        logo: string | null;
        capBefore: number;
        capAfter: number;
      }[];
      assets: {
        kind: TradeAssetKind;
        toTeamId: number;
        salary: number;
        player: { name: string; position: string | null } | null;
        pick: {
          seasonStartYear: number;
          round: number;
          originalTeamAbbr: string | null;
        } | null;
      }[];
      /** The last season of each moving player's deal, by player name. */
      throughByPlayer: Map<string, number | null>;
      processedAt: Date;
    },
  ) {
    const teams: NewsTeamLeg[] = input.teams.map((team) => {
      const received = input.assets.filter(
        (asset) => asset.toTeamId === team.teamId,
      );
      return {
        teamId: team.teamId,
        name: team.name,
        abbr: team.abbr,
        logo: team.logo,
        players: received
          .filter((asset) => asset.kind === TradeAssetKind.player)
          .map((asset) => ({
            name: asset.player?.name ?? 'Player',
            position: asset.player?.position ?? null,
            salary: asset.salary,
            throughSeasonStartYear:
              input.throughByPlayer.get(asset.player?.name ?? '') ?? null,
          })),
        picks: received
          .filter((asset) => asset.kind === TradeAssetKind.draftPick)
          .map((asset) => ({
            label: asset.pick
              ? pickLabel(asset.pick.seasonStartYear, asset.pick.round)
              : 'Draft pick',
            originalTeamAbbr: asset.pick?.originalTeamAbbr ?? null,
          })),
        capBefore: team.capBefore,
        capAfter: team.capAfter,
        capSpaceAfter: input.salaryCap - team.capAfter,
      };
    });

    await this.write(tx, {
      leagueId: input.leagueId,
      type: NewsItemType.trade,
      sourceType: NewsItemSource.trade,
      sourceId: input.tradeId,
      payload: {
        teams,
        summary: null,
        status: `Accepted by all teams · Processed ${input.processedAt.toISOString()}`,
      },
    });
  }

  /**
   * One team, one player: a signing, an extension, a waiver, a claim or a
   * matched offer sheet. They differ only in the headline, so they share a
   * writer.
   */
  async publishPlayerMove(
    tx: Prisma.TransactionClient,
    input: {
      leagueId: number;
      type: NewsItemType;
      sourceType: NewsItemSource;
      sourceId: number;
      team: {
        teamId: number;
        name: string;
        abbr: string;
        logo: string | null;
        capBefore: number | null;
        capAfter: number | null;
        salaryCap: number | null;
      };
      player: {
        name: string;
        position: string | null;
        salary: number | null;
        throughSeasonStartYear: number | null;
      };
      summary?: string | null;
    },
  ) {
    const capAfter = input.team.capAfter;
    await this.write(tx, {
      leagueId: input.leagueId,
      type: input.type,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      payload: {
        teams: [
          {
            teamId: input.team.teamId,
            name: input.team.name,
            abbr: input.team.abbr,
            logo: input.team.logo,
            players: [input.player],
            picks: [],
            capBefore: input.team.capBefore,
            capAfter,
            capSpaceAfter:
              input.team.salaryCap !== null && capAfter !== null
                ? input.team.salaryCap - capAfter
                : null,
          },
        ],
        summary: input.summary ?? null,
        status: null,
      },
    });
  }

  /** A trade the commissioner reversed. */
  async publishVeto(
    tx: Prisma.TransactionClient,
    input: {
      leagueId: number;
      tradeId: number;
      reason: string | null;
      teams: {
        teamId: number;
        name: string;
        abbr: string;
        logo: string | null;
      }[];
    },
  ) {
    await this.write(tx, {
      leagueId: input.leagueId,
      type: NewsItemType.veto,
      sourceType: NewsItemSource.trade,
      // A veto is its own post, so it cannot share the trade's source id.
      sourceId: -input.tradeId,
      payload: {
        teams: input.teams.map((team) => ({
          ...team,
          players: [],
          picks: [],
          capBefore: null,
          capAfter: null,
          capSpaceAfter: null,
        })),
        summary: input.reason,
        status: null,
      },
    });
  }
}
