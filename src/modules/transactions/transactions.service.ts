import { Injectable } from '@nestjs/common';
import { DraftKind, FreeAgencyOfferStatus, TradeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The league's transaction feed.
 *
 * There is no transaction log table, and there does not need to be. A processed
 * trade, an accepted offer, a waiver, a pick movement and a draft selection are
 * each already stored with their own timestamp and their own meaning. Reading
 * the five and merging them keeps one source of truth per kind of move; a log
 * table would be a sixth copy that can drift from all of them.
 */

export type TransactionType =
  | 'Trade Accepted'
  | 'Player Signed'
  | 'Free Agent Signed'
  | 'Player Waived'
  | 'Player Drafted'
  | 'Draft Pick Traded';

/** The page's tabs group the types; a type belongs to exactly one. */
export type TransactionCategory = 'Trades' | 'Signings' | 'Waivers' | 'Draft';

export type TransactionItem = {
  id: string;
  type: TransactionType;
  category: TransactionCategory;
  /** "Celtics ↔ Hawks" for a trade, one team's name otherwise. */
  teams: string | null;
  description: string;
  date: string;
  /** Whether the viewer's own team is in it. Null when the viewer holds none. */
  mine: boolean;
  teamIds: number[];
};

const money = (value: number) =>
  `$${Math.round(value).toLocaleString('en-US')}`;

const roundLabel = (round: number) =>
  round === 1 ? '1st round' : round === 2 ? '2nd round' : `round ${round}`;

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every move in the league, newest first.
   *
   * `take` is applied to each source before the merge, so a league with a
   * hundred trades and two signings still shows the signings — a single
   * ordered query across four tables would have to be a view.
   */
  async feed(
    leagueId: number,
    options: { teamId?: number | null; take?: number } = {},
  ): Promise<TransactionItem[]> {
    const take = options.take ?? 50;
    const mine = options.teamId ?? null;

    const [trades, signings, waivers, pickEvents, selections] =
      await Promise.all([
        this.prisma.trade.findMany({
          where: { leagueId, status: TradeStatus.processed },
          orderBy: { processedAt: 'desc' },
          take,
          select: {
            id: true,
            processedAt: true,
            updatedAt: true,
            teams: { select: { team: { select: { id: true, name: true } } } },
            assets: {
              select: {
                kind: true,
                fromTeamId: true,
                toTeamId: true,
                salary: true,
                leaguePlayer: {
                  select: { player: { select: { name: true } } },
                },
                draftPick: {
                  select: { seasonStartYear: true, round: true },
                },
              },
            },
          },
        }),
        this.prisma.freeAgencyOffer.findMany({
          where: { leagueId, status: FreeAgencyOfferStatus.accepted },
          orderBy: { respondedAt: 'desc' },
          take,
          select: {
            id: true,
            years: true,
            firstYearSalary: true,
            respondedAt: true,
            updatedAt: true,
            team: { select: { id: true, name: true } },
            leaguePlayer: { select: { player: { select: { name: true } } } },
          },
        }),
        // Read from the release rather than from the dead money it creates: a
        // player with nothing guaranteed is waived and owes nothing, and that is
        // still a transaction.
        this.prisma.waiver.findMany({
          where: { leagueId },
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            deadMoneyTotal: true,
            isStretched: true,
            seasonsOwed: true,
            createdAt: true,
            team: { select: { id: true, name: true } },
            player: { select: { name: true } },
          },
        }),
        this.prisma.draftPickEvent.findMany({
          where: { pick: { leagueId } },
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            createdAt: true,
            reason: true,
            tradeId: true,
            fromTeam: { select: { id: true, name: true } },
            toTeam: { select: { id: true, name: true } },
            pick: { select: { seasonStartYear: true, round: true } },
          },
        }),
        // A filled slot *is* the selection: `pickedAt` is when it was made and
        // `overall` is where. Nothing else records a draft pick being used.
        this.prisma.draftOrderSlot.findMany({
          where: {
            draft: { leagueId },
            pickedAt: { not: null },
            playerId: { not: null },
          },
          orderBy: { pickedAt: 'desc' },
          take,
          select: {
            id: true,
            round: true,
            overall: true,
            pickedAt: true,
            team: { select: { id: true, name: true } },
            player: { select: { name: true } },
            draft: { select: { kind: true, seasonStartYear: true } },
          },
        }),
      ]);

    const items: (TransactionItem & { at: Date })[] = [];

    for (const trade of trades) {
      const names = trade.teams.map((side) => side.team.name);
      const teamIds = trade.teams.map((side) => side.team.id);

      const players = trade.assets
        .map((asset) => asset.leaguePlayer?.player.name)
        .filter(Boolean);
      const picks = trade.assets
        .filter((asset) => asset.draftPick)
        .map(
          (asset) =>
            `${asset.draftPick?.seasonStartYear} ${roundLabel(asset.draftPick?.round ?? 1)}`,
        );

      const parts: string[] = [];
      if (players.length) parts.push(players.join(', '));
      if (picks.length) parts.push(picks.join(', '));

      items.push({
        id: `trade-${trade.id}`,
        type: 'Trade Accepted',
        category: 'Trades',
        teams: names.join(' ↔ '),
        description: parts.join(' · ') || 'Exceptions only.',
        date: (trade.processedAt ?? trade.updatedAt).toISOString(),
        at: trade.processedAt ?? trade.updatedAt,
        mine: mine !== null && teamIds.includes(mine),
        teamIds,
      });
    }

    for (const offer of signings) {
      items.push({
        id: `signing-${offer.id}`,
        type: 'Free Agent Signed',
        category: 'Signings',
        teams: offer.team.name,
        description: `${offer.leaguePlayer.player.name} — ${offer.years} year${offer.years === 1 ? '' : 's'}, ${money(offer.firstYearSalary)} first year`,
        date: (offer.respondedAt ?? offer.updatedAt).toISOString(),
        at: offer.respondedAt ?? offer.updatedAt,
        mine: mine !== null && offer.team.id === mine,
        teamIds: [offer.team.id],
      });
    }

    for (const row of waivers) {
      // Rule 10.14 — nothing guaranteed means nothing owed, and saying
      // "$0 dead money" would read as a failure rather than a clean release.
      const cost =
        row.deadMoneyTotal > 0
          ? `${money(row.deadMoneyTotal)} dead money${
              row.isStretched
                ? `, stretched over ${row.seasonsOwed} season${row.seasonsOwed === 1 ? '' : 's'}`
                : ''
            }`
          : 'no dead money';

      items.push({
        id: `waive-${row.id}`,
        type: 'Player Waived',
        category: 'Waivers',
        teams: row.team.name,
        description: `${row.player.name} — ${cost}`,
        date: row.createdAt.toISOString(),
        at: row.createdAt,
        mine: mine !== null && row.team.id === mine,
        teamIds: [row.team.id],
      });
    }

    for (const slot of selections) {
      // Both guarded in the query; narrowing them again is what tells
      // TypeScript the nullable columns are filled.
      if (!slot.pickedAt || !slot.player) continue;

      const draftLabel =
        slot.draft.kind === DraftKind.startup
          ? 'startup draft'
          : `${slot.draft.seasonStartYear} rookie draft`;

      items.push({
        id: `pick-made-${slot.id}`,
        type: 'Player Drafted',
        category: 'Draft',
        teams: slot.team.name,
        description: `${slot.player.name} — ${draftLabel}, ${roundLabel(slot.round)}, pick ${slot.overall} overall`,
        date: slot.pickedAt.toISOString(),
        at: slot.pickedAt,
        mine: mine !== null && slot.team.id === mine,
        teamIds: [slot.team.id],
      });
    }

    for (const event of pickEvents) {
      // A pick that moved in a trade is already described by that trade's own
      // row, so only a commissioner's reassignment is a transaction of its own.
      if (event.tradeId) continue;

      const teamIds = [event.toTeam.id];
      if (event.fromTeam) teamIds.push(event.fromTeam.id);

      items.push({
        id: `pick-${event.id}`,
        type: 'Draft Pick Traded',
        category: 'Trades',
        teams: event.fromTeam
          ? `${event.fromTeam.name} → ${event.toTeam.name}`
          : event.toTeam.name,
        description:
          event.reason ??
          `${event.pick.seasonStartYear} ${roundLabel(event.pick.round)} pick`,
        date: event.createdAt.toISOString(),
        at: event.createdAt,
        mine: mine !== null && teamIds.includes(mine),
        teamIds,
      });
    }

    return (
      items
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, take)
        // `at` is the Date the sort needed; the item carries its own ISO `date`.
        .map((item) => {
          const { at, ...rest } = item;
          void at;
          return rest;
        })
    );
  }

  /**
   * One team's moves, for the dashboard's activity card.
   *
   * The same feed narrowed, rather than a second query that could describe the
   * same trade differently.
   */
  async forTeam(leagueId: number, teamId: number, take = 8) {
    const all = await this.feed(leagueId, { teamId, take: take * 4 });
    return all.filter((item) => item.teamIds.includes(teamId)).slice(0, take);
  }
}
