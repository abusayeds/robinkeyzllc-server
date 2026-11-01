import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/appError';
import { listNotificationDto } from './dto/list-notification.dto';
import { TNotification, TNotifyInput } from './notification.types';

const DEFAULT_LIMIT = 10;

@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  // Called by other modules when something worth telling the user happens.
  // Never let a failed notification break the action that caused it.
  async notify(input: TNotifyInput) {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        detail: input.detail,
        leagueId: input.leagueId ?? null,
        link: input.link ?? null,
      },
    });
  }

  async notifyMany(inputs: TNotifyInput[]) {
    if (!inputs.length) return { count: 0 };

    return this.prisma.notification.createMany({
      data: inputs.map((input) => ({
        userId: input.userId,
        type: input.type,
        title: input.title,
        detail: input.detail,
        leagueId: input.leagueId ?? null,
        link: input.link ?? null,
      })),
    });
  }

  async listDB(userId: number, query: listNotificationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.leagueId ? { leagueId: query.leagueId } : {}),
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [rows, totalItem] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const totalPage = Math.ceil(totalItem / limit) || 1;

    return {
      data: rows.map((row) => this.toNotification(row)),
      // Same shape QueryBuilder produces, so every list in the API answers
      // with one envelope.
      pagination: {
        totalPage,
        currentPage: page,
        prevPage: page - 1 > 0 ? page - 1 : 1,
        nextPage: page + 1 <= totalPage ? page + 1 : totalPage,
        limit,
        totalItem,
      },
    };
  }

  async unreadCountDB(userId: number, leagueId?: number) {
    const count = await this.prisma.notification.count({
      where: {
        userId,
        readAt: null,
        ...(leagueId ? { leagueId } : {}),
      },
    });

    return { unreadCount: count };
  }

  async markReadDB(userId: number, id: number): Promise<TNotification> {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
    });

    // Checked against the caller so one user cannot read another's row by id.
    if (!existing || existing.userId !== userId) {
      throw new AppError(HttpStatus.NOT_FOUND, 'Notification not found.');
    }

    if (existing.readAt) return this.toNotification(existing);

    const row = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    return this.toNotification(row);
  }

  async markAllReadDB(userId: number, leagueId?: number) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        ...(leagueId ? { leagueId } : {}),
      },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }

  private toNotification(row: {
    id: number;
    type: TNotification['type'];
    title: string;
    detail: string;
    link: string | null;
    leagueId: number | null;
    readAt: Date | null;
    createdAt: Date;
  }): TNotification {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      detail: row.detail,
      link: row.link,
      leagueId: row.leagueId,
      unread: row.readAt === null,
      createdAt: row.createdAt,
    };
  }
}
