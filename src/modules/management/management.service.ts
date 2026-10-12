import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Management } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AppError } from '../../common/errors/appError';
import { QueryBuilder } from '../../builder/queryBuilder';
import { crateManagementDto, ManagementType } from './dto/management.dto';

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
}
