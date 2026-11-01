import { HttpStatus, Injectable } from '@nestjs/common';
import {
  LeagueContentType,
  Prisma,
  type Management,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AppError } from '../../common/errors/appError';
import { QueryBuilder } from '../../builder/queryBuilder';
import { crateManagementDto, ManagementType } from './dto/management.dto';
import { TLeagueContentEntry } from './management.types';

// Only these three have a platform-wide counterpart to inherit from. Help is
// league specific, so a league that has not written it has nothing to show.
const PLATFORM_FALLBACK: Partial<Record<LeagueContentType, ManagementType>> = {
  [LeagueContentType.about]: 'about',
  [LeagueContentType.terms]: 'terms',
  [LeagueContentType.privacy]: 'privacy',
};

const CONTENT_TYPES = Object.values(LeagueContentType);

@Injectable()
export class managementService {
  constructor(private prisma: PrismaService) {}

  async managementCreateDB(payload: crateManagementDto) {
    const result = await this.prisma.management.upsert({
      where: {
        type: payload.type,
      },
      update: payload,
      create: payload,
    });
    return result;
  }

  async managementGetAllDB(type?: string) {
    if (type) {
      const result = await this.prisma.management.findUnique({
        where: { type: type as ManagementType },
      });
      if (!result) {
        throw new AppError(
          HttpStatus.NOT_FOUND,
          `No ${type} description found.`,
        );
      }
      return result;
    }

    const result = await this.prisma.management.findMany();
    return result;
  }

  async managementListDB(query: Record<string, unknown>) {
    const queryBuilder = new QueryBuilder<Management>(query)
      .search(['type', 'description'])
      .filter()
      .sort()
      .fields()
      .paginate();

    const [data, totalItem] = await Promise.all([
      this.prisma.management.findMany(
        queryBuilder.build<Prisma.ManagementFindManyArgs>(),
      ),
      this.prisma.management.count({ where: queryBuilder.getWhere() }),
    ]);

    return { data, pagination: queryBuilder.calculatePagination(totalItem) };
  }

  async leagueContentListDB(leagueId: number): Promise<TLeagueContentEntry[]> {
    const [rows, platform] = await Promise.all([
      this.prisma.leagueContent.findMany({
        where: { leagueId },
        include: { updatedBy: { select: { id: true, name: true } } },
      }),
      this.prisma.management.findMany(),
    ]);

    const byType = new Map(rows.map((row) => [row.type, row]));
    const platformByType = new Map(platform.map((row) => [row.type, row]));

    return CONTENT_TYPES.map((type) =>
      this.toContentEntry(type, byType.get(type), platformByType),
    );
  }

  async leagueContentGetDB(
    leagueId: number,
    type: LeagueContentType,
  ): Promise<TLeagueContentEntry> {
    const row = await this.prisma.leagueContent.findUnique({
      where: { leagueId_type: { leagueId, type } },
      include: { updatedBy: { select: { id: true, name: true } } },
    });

    if (row) return this.toContentEntry(type, row);

    const fallbackType = PLATFORM_FALLBACK[type];
    const platform = fallbackType
      ? await this.prisma.management.findUnique({
          where: { type: fallbackType },
        })
      : null;

    return this.toContentEntry(
      type,
      null,
      platform ? new Map([[platform.type, platform]]) : undefined,
    );
  }

  async leagueContentSaveDB(
    leagueId: number,
    type: LeagueContentType,
    payload: { description: string },
    updatedById: number,
  ): Promise<TLeagueContentEntry> {
    const description = payload.description.trim();

    const row = await this.prisma.leagueContent.upsert({
      where: { leagueId_type: { leagueId, type } },
      update: { description, updatedById },
      create: { leagueId, type, description, updatedById },
      include: { updatedBy: { select: { id: true, name: true } } },
    });

    return this.toContentEntry(type, row);
  }

  private toContentEntry(
    type: LeagueContentType,
    row?: {
      description: string;
      updatedAt: Date;
      updatedBy: { id: number; name: string } | null;
    } | null,
    platformByType?: Map<string, { description: string; updatedAt: Date }>,
  ): TLeagueContentEntry {
    if (row) {
      return {
        type,
        description: row.description,
        source: 'league',
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      };
    }

    const fallbackType = PLATFORM_FALLBACK[type];
    const platform = fallbackType
      ? platformByType?.get(fallbackType)
      : undefined;

    if (platform) {
      return {
        type,
        description: platform.description,
        source: 'platform',
        updatedAt: platform.updatedAt,
        updatedBy: null,
      };
    }

    return {
      type,
      description: '',
      source: null,
      updatedAt: null,
      updatedBy: null,
    };
  }
}
