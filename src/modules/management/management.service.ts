import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { crateManagementDto, ManagementType } from './dto/management.dto';
@Injectable()
export class managementService {
  constructor(private prisma: PrismaService) {}
  // ==========  create management  ============ //
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
  // ==========  get management  ============ //
  async managementGetAllDB(type?: string) {
    if (type) {
      const result = await this.prisma.management.findUnique({
        where: { type: type as ManagementType },
      });
      return result;
    } else {
      const result = await this.prisma.management.findMany();
      return result;
    }
  }
}
