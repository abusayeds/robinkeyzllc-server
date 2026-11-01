import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CAP_YEAR_2026, MINIMUM_SALARY_SCALE, ROOKIE_SCALE } from './cba.seed';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedAdmin();
    await this.seedCbaFigures();
  }

  /**
   * The AVORA CBA figures, from the client's rule book.
   *
   * Every write is a create-if-absent. Rule 2.2 gives the Super Admin
   * ownership of these from the moment they exist, so a seed that ran again
   * on every boot would quietly undo their edits.
   */
  private async seedCbaFigures() {
    try {
      await this.prisma.capRuleSet.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
      });
      await this.prisma.secondRoundScale.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
      });

      await this.prisma.capYear.upsert({
        where: { seasonStartYear: CAP_YEAR_2026.seasonStartYear },
        create: CAP_YEAR_2026,
        update: {},
      });

      for (const step of MINIMUM_SALARY_SCALE) {
        await this.prisma.minimumSalaryStep.upsert({
          where: { yearsOfService: step.yearsOfService },
          create: step,
          update: {},
        });
      }

      for (const slot of ROOKIE_SCALE) {
        await this.prisma.rookieScaleSlot.upsert({
          where: { pick: slot.pick },
          create: slot,
          update: {},
        });
      }

      this.logger.log('CBA figures are in place');
    } catch (error) {
      this.logger.error(
        `Could not seed the CBA figures: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async seedAdmin() {
    try {
      const existingAdmin = await this.prisma.user.findFirst({
        where: { role: Role.superAdmin, isDeleted: false },
        select: { email: true },
      });

      if (existingAdmin) {
        return;
      }

      const name = this.config.get<string>('ADMIN_NAME') ?? 'Admin';
      const email = this.config.get<string>('ADMIN_EMAIL') ?? 'admin@gmail.com';
      const phone = this.config.get<string>('ADMIN_PHONE') ?? '01700000000';
      const password = this.config.get<string>('ADMIN_PASSWORD') ?? '1qazxsw2';

      const hashedPassword = await bcrypt.hash(password, 10);

      // upsert, not create: the email may already belong to a normal user.
      const admin = await this.prisma.user.upsert({
        where: { email },
        update: {
          role: Role.superAdmin,
          isDeleted: false,
          isEmailVerified: true,
        },
        create: {
          name,
          email,
          phone,
          password: hashedPassword,
          role: Role.superAdmin,
          isEmailVerified: true,
        },
        select: { id: true, email: true },
      });

      this.logger.log(`Super admin seeded: ${admin.email} (id ${admin.id})`);
    } catch (error) {
      // Seeding must never stop the server from starting.
      this.logger.error('Super admin seeding failed', error as Error);
    }
  }
}
