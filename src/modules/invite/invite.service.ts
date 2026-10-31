import { HttpStatus, Injectable } from '@nestjs/common';
import { LeagueInviteStatus, LeagueRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/appError';
import { NotificationService } from '../notification/notification.service';
import { TLeagueInvite, TMyInvite } from './invite.types';

@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /** The league's own list, so the commissioner can see who owes an answer. */
  async listForLeague(leagueId: number): Promise<TLeagueInvite[]> {
    const invites = await this.prisma.leagueInvite.findMany({
      where: { leagueId, status: { not: LeagueInviteStatus.cancelled } },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
        invitedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return invites.map((invite) => ({
      id: invite.id,
      status: invite.status,
      user: {
        userId: invite.user.id,
        name: invite.user.name,
        email: invite.user.email,
        image: invite.user.image,
      },
      invitedBy: invite.invitedBy?.name ?? null,
      createdAt: invite.createdAt,
      respondedAt: invite.respondedAt,
    }));
  }

  async invite(leagueId: number, userId: number, actingUserId: number) {
    const [league, user, membership] = await Promise.all([
      this.prisma.league.findUniqueOrThrow({
        where: { id: leagueId },
        select: { name: true },
      }),
      this.prisma.user.findFirst({
        where: { id: userId, isDeleted: false },
        select: { id: true, name: true },
      }),
      this.prisma.leagueMember.findUnique({
        where: { userId_leagueId: { userId, leagueId } },
        select: { id: true },
      }),
    ]);

    if (!user) {
      throw new AppError(HttpStatus.NOT_FOUND, 'User not found.');
    }
    if (membership) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${user.name} is already a member of this league.`,
      );
    }

    const existing = await this.prisma.leagueInvite.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
      select: { status: true },
    });

    if (existing?.status === LeagueInviteStatus.pending) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        `${user.name} already has a pending invite to this league.`,
      );
    }

    // A declined or cancelled invite is reopened rather than duplicated, which
    // is what the single row per user per league is for.
    const invite = await this.prisma.leagueInvite.upsert({
      where: { leagueId_userId: { leagueId, userId } },
      create: {
        leagueId,
        userId,
        invitedById: actingUserId,
        status: LeagueInviteStatus.pending,
      },
      update: {
        invitedById: actingUserId,
        status: LeagueInviteStatus.pending,
        respondedAt: null,
      },
      select: { id: true },
    });

    await this.notificationService.notify({
      userId,
      leagueId,
      type: 'leagueInvite',
      title: `You have been invited to ${league.name}`,
      detail: 'Accept the invite from your Avora Home page to join the league.',
      link: '/home',
    });

    return { id: invite.id, userId, status: LeagueInviteStatus.pending };
  }

  async cancel(leagueId: number, userId: number) {
    const invite = await this.prisma.leagueInvite.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
      select: { id: true, status: true },
    });

    if (!invite || invite.status !== LeagueInviteStatus.pending) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'There is no pending invite for that user.',
      );
    }

    await this.prisma.leagueInvite.update({
      where: { id: invite.id },
      data: {
        status: LeagueInviteStatus.cancelled,
        respondedAt: new Date(),
      },
    });

    return { id: invite.id, userId, status: LeagueInviteStatus.cancelled };
  }

  /** Avora Home reads this: the invites waiting on the signed-in user. */
  async listMine(userId: number): Promise<TMyInvite[]> {
    const invites = await this.prisma.leagueInvite.findMany({
      where: {
        userId,
        status: LeagueInviteStatus.pending,
        league: { isDeleted: false },
      },
      include: {
        league: { select: { id: true, name: true, logo: true, season: true } },
        invitedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return invites.map((invite) => ({
      id: invite.id,
      leagueId: invite.league.id,
      leagueName: invite.league.name,
      leagueLogo: invite.league.logo,
      season: invite.league.season,
      invitedBy: invite.invitedBy?.name ?? null,
      createdAt: invite.createdAt,
    }));
  }

  async accept(inviteId: number, userId: number) {
    const invite = await this.findMyPending(inviteId, userId);

    // Joining is two writes, so neither may land without the other.
    await this.prisma.$transaction(async (tx) => {
      await tx.leagueMember.upsert({
        where: { userId_leagueId: { userId, leagueId: invite.leagueId } },
        create: {
          userId,
          leagueId: invite.leagueId,
          role: LeagueRole.member,
        },
        update: {},
      });
      await tx.leagueInvite.update({
        where: { id: inviteId },
        data: {
          status: LeagueInviteStatus.accepted,
          respondedAt: new Date(),
        },
      });
    });

    if (invite.invitedById) {
      await this.notificationService.notify({
        userId: invite.invitedById,
        leagueId: invite.leagueId,
        type: 'leagueInvite',
        title: `${invite.user.name} joined ${invite.league.name}`,
        detail: 'You can now assign them a team from User Assignment.',
        link: '/league-office/users',
      });
    }

    return {
      id: inviteId,
      leagueId: invite.leagueId,
      leagueName: invite.league.name,
      status: LeagueInviteStatus.accepted,
    };
  }

  async decline(inviteId: number, userId: number) {
    const invite = await this.findMyPending(inviteId, userId);

    await this.prisma.leagueInvite.update({
      where: { id: inviteId },
      data: {
        status: LeagueInviteStatus.declined,
        respondedAt: new Date(),
      },
    });

    if (invite.invitedById) {
      await this.notificationService.notify({
        userId: invite.invitedById,
        leagueId: invite.leagueId,
        type: 'leagueInvite',
        title: `${invite.user.name} declined your invite`,
        detail: `They will not be joining ${invite.league.name}.`,
        link: '/league-office/users',
      });
    }

    return {
      id: inviteId,
      leagueId: invite.leagueId,
      status: LeagueInviteStatus.declined,
    };
  }

  /**
   * The invited user is not a league member yet, so LeagueGuard cannot protect
   * these two routes. Ownership of the invite is the authorisation, and a
   * stranger's invite answers 404 rather than 403 so its existence stays
   * private.
   */
  private async findMyPending(inviteId: number, userId: number) {
    const invite = await this.prisma.leagueInvite.findUnique({
      where: { id: inviteId },
      include: {
        league: { select: { name: true, isDeleted: true } },
        user: { select: { name: true } },
      },
    });

    if (!invite || invite.userId !== userId || invite.league.isDeleted) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Invite not found.');
    }
    if (invite.status !== LeagueInviteStatus.pending) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'This invite has already been answered.',
      );
    }

    return invite;
  }
}
