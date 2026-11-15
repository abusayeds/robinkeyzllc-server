import { HttpStatus, Injectable } from '@nestjs/common';
import { LeaguePlayerStatus, LeagueRole, Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/appError';
import { PrismaService } from '../../prisma/prisma.service';
import { parseSeasonLabel } from '../../utils/season';
import { ListOnTradeBlockDto } from './dto/list-on-trade-block.dto';

const ENTRY_SELECT = {
  id: true,
  teamId: true,
  leaguePlayerId: true,
  note: true,
  createdAt: true,
  team: {
    select: { id: true, name: true, abbr: true, color: true, logo: true },
  },
  leaguePlayer: {
    select: {
      id: true,
      playerId: true,
      birdYears: true,
      player: {
        select: {
          name: true,
          position: true,
          headshot: true,
          nbaTeam: { select: { abbreviation: true } },
        },
      },
      contracts: {
        where: { isActive: true },
        select: {
          contractType: true,
          endSeasonStartYear: true,
          years: {
            select: { seasonStartYear: true, capHit: true },
          },
        },
      },
    },
  },
} satisfies Prisma.TradeBlockEntrySelect;

type EntryRow = Prisma.TradeBlockEntryGetPayload<{
  select: typeof ENTRY_SELECT;
}>;

/**
 * The league's notice board: who each team has said it would move.
 *
 * Nothing here is a rule. A listing does not reserve the player, does not
 * stop him being signed or waived, and is not checked when a trade is judged
 * — it only saves owners from asking each other one at a time.
 */
@Injectable()
export class TradeBlockService {
  constructor(private readonly prisma: PrismaService) {}

  async list(leagueId: number, userId: number) {
    const seasonStartYear = await this.seasonOf(leagueId);

    const [entries, holder] = await Promise.all([
      this.prisma.tradeBlockEntry.findMany({
        where: { leagueId },
        orderBy: { createdAt: 'desc' },
        select: ENTRY_SELECT,
      }),
      this.prisma.teamMember.findFirst({
        where: { leagueId, userId },
        select: { teamId: true },
      }),
    ]);

    const myTeamId = holder?.teamId ?? null;

    return {
      myTeamId,
      seasonStartYear,
      entries: entries.map((entry) => this.toEntry(entry, seasonStartYear)),
    };
  }

  /** Puts a player on the block, or edits the note on a listing already there. */
  async add(leagueId: number, userId: number, payload: ListOnTradeBlockDto) {
    const player = await this.prisma.leaguePlayer.findFirst({
      where: { id: payload.leaguePlayerId, leagueId },
      select: { id: true, teamId: true, status: true },
    });

    if (!player) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'That player is not in this league.',
      );
    }

    if (!player.teamId || player.status !== LeaguePlayerStatus.rostered) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'Only a player on a roster can be put on the trade block.',
      );
    }

    await this.assertMayManage(leagueId, player.teamId, userId);

    const note = payload.note?.trim() || null;

    // Upsert rather than create: listing a player who is already listed is
    // how the note gets changed, and it should not be an error.
    await this.prisma.tradeBlockEntry.upsert({
      where: { leaguePlayerId: player.id },
      create: {
        leagueId,
        teamId: player.teamId,
        leaguePlayerId: player.id,
        note,
        listedById: userId,
      },
      update: { note, teamId: player.teamId, listedById: userId },
    });

    return this.list(leagueId, userId);
  }

  async remove(leagueId: number, userId: number, leaguePlayerId: number) {
    const entry = await this.prisma.tradeBlockEntry.findFirst({
      where: { leagueId, leaguePlayerId },
      select: { id: true, teamId: true },
    });

    if (!entry) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'That player is not on the trade block.',
      );
    }

    await this.assertMayManage(leagueId, entry.teamId, userId);

    await this.prisma.tradeBlockEntry.delete({ where: { id: entry.id } });

    return this.list(leagueId, userId);
  }

  private toEntry(entry: EntryRow, seasonStartYear: number) {
    const leaguePlayer = entry.leaguePlayer;
    const contract = leaguePlayer.contracts[0] ?? null;
    const thisSeason =
      contract?.years.find(
        (year) => year.seasonStartYear === seasonStartYear,
      ) ?? null;

    return {
      id: entry.id,
      note: entry.note,
      listedAt: entry.createdAt,
      team: {
        id: entry.team.id,
        name: entry.team.name,
        abbr: entry.team.abbr,
        color: entry.team.color,
        logo: entry.team.logo,
      },
      leaguePlayerId: leaguePlayer.id,
      playerId: leaguePlayer.playerId,
      name: leaguePlayer.player.name,
      position: leaguePlayer.player.position,
      headshot: leaguePlayer.player.headshot,
      nbaTeam: leaguePlayer.player.nbaTeam?.abbreviation ?? null,
      birdYears: leaguePlayer.birdYears,
      contractType: contract?.contractType ?? null,
      // How many seasons are left including this one, so a card can say
      // "2 yrs left" without being handed the end year to subtract.
      yearsLeft: contract
        ? Math.max(0, contract.endSeasonStartYear - seasonStartYear + 1)
        : null,
      capHit: thisSeason?.capHit ?? null,
    };
  }

  private async seasonOf(leagueId: number) {
    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { season: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found');
    }
    return parseSeasonLabel(league.season) ?? new Date().getUTCFullYear();
  }

  /** Only the team's own owner, or whoever runs the league, lists its players. */
  private async assertMayManage(
    leagueId: number,
    teamId: number,
    userId: number,
  ) {
    const [holder, membership] = await Promise.all([
      this.prisma.teamMember.findFirst({
        where: { leagueId, teamId, userId },
        select: { teamId: true },
      }),
      this.prisma.leagueMember.findUnique({
        where: { userId_leagueId: { userId, leagueId } },
        select: { role: true },
      }),
    ]);

    const manages =
      membership?.role === LeagueRole.commissioner ||
      membership?.role === LeagueRole.coCommissioner;

    if (!holder && !manages) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'You can only change the trade block for a team you hold.',
      );
    }
  }
}
