import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Auth } from '../../common/decorators/auth.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { role } from '../../utils/role';
import { parseSeasonLabel } from '../../utils/season';
import { sendResponse } from '../../utils/sendResponse';
import { PrismaService } from '../../prisma/prisma.service';
import { GuaranteeType } from '@prisma/client';
import { CapYearDto } from './dto/cap-year.dto';
import { ContractReferenceDto } from './dto/contract-reference.dto';
import { CapService } from './cap.service';
import { HardCapService } from './hard-cap.service';

// Article 2 — the global figures belong to the platform, so editing them is a
// Super Admin route. A league reads its own effective figures separately.
@Controller('cap')
export class CapController {
  constructor(
    private readonly capService: CapService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('years')
  @Auth()
  async years(@Res() res: Response) {
    const data = await this.capService.years();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Cap years retrieved successfully',
      data,
    });
  }

  @Get('rules')
  @Auth()
  async rules(@Res() res: Response) {
    const data = await this.capService.ruleSet();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Cap rules retrieved successfully',
      data,
    });
  }

  // Rule 2.3 — only the Super Admin enters a league year's figures.
  @Put('years/:seasonStartYear')
  @Auth(role.superAdmin)
  async upsertYear(
    @Res() res: Response,
    @Param('seasonStartYear', ParseIntPipe) seasonStartYear: number,
    @Body() payload: CapYearDto,
  ) {
    const data = await this.prisma.capYear.upsert({
      where: { seasonStartYear },
      create: { seasonStartYear, ...payload },
      update: payload,
    });

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Cap year saved successfully',
      data,
    });
  }

  /**
   * Loads the global contract database.
   *
   * Not a sync: balldontlie publishes no contract endpoint, so the figures
   * come in from whatever the Super Admin has. A Startup league reads this
   * when a player is drafted, which is what keeps the numbers the same in
   * every league.
   */
  @Put('contracts')
  @Auth(role.superAdmin)
  async loadContracts(
    @Res() res: Response,
    @Body() payload: ContractReferenceDto,
  ) {
    const bdlIds = [...new Set(payload.rows.map((row) => row.bdlPlayerId))];
    const players = await this.prisma.player.findMany({
      where: { bdlPlayerId: { in: bdlIds } },
      select: { id: true, bdlPlayerId: true },
    });
    const idByBdl = new Map(
      players.map((player) => [player.bdlPlayerId as number, player.id]),
    );

    let written = 0;
    const unknown: number[] = [];

    for (const row of payload.rows) {
      const playerId = idByBdl.get(row.bdlPlayerId);
      if (!playerId) {
        unknown.push(row.bdlPlayerId);
        continue;
      }

      const data = {
        salary: row.salary,
        optionType: row.optionType ?? null,
        guaranteeType: row.guaranteeType ?? GuaranteeType.full,
        guaranteedAmount: row.guaranteedAmount ?? null,
        endSeasonStartYear: row.endSeasonStartYear ?? null,
        source: row.source?.trim() || 'superAdmin',
      };

      await this.prisma.playerContractReference.upsert({
        where: {
          playerId_seasonStartYear: {
            playerId,
            seasonStartYear: row.seasonStartYear,
          },
        },
        create: { playerId, seasonStartYear: row.seasonStartYear, ...data },
        update: data,
      });
      written += 1;
    }

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Contract database loaded successfully',
      data: {
        written,
        // Players this deployment has never synced. Worth naming rather than
        // silently dropping: it usually means the player sync has not run.
        skippedUnknownPlayers: [...new Set(unknown)],
      },
    });
  }
}

// What one league's figures actually are, which every member may see.
@Controller('leagues/:leagueId/cap')
export class LeagueCapController {
  constructor(
    private readonly capService: CapService,
    private readonly hardCapService: HardCapService,
    private readonly prisma: PrismaService,
  ) {}

  /** The league year this league is in, the way every cap route reads it. */
  private async seasonOf(leagueId: number) {
    const league = await this.prisma.league.findUnique({
      where: { id: leagueId },
      select: { season: true },
    });
    return (
      (league ? parseSeasonLabel(league.season) : null) ??
      new Date().getUTCFullYear()
    );
  }

  @Get()
  @LeagueAuth()
  async effective(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const seasonStartYear = await this.seasonOf(leagueId);
    const data = await this.capService.forLeague(leagueId, seasonStartYear);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Cap figures retrieved successfully',
      data,
    });
  }

  /**
   * Rule 4.7 — every team's hard cap, the room left under it, and what the
   * open roster spots reserve (Rule 4.8).
   */
  @Get('hard-caps')
  @LeagueAuth()
  async hardCaps(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const seasonStartYear = await this.seasonOf(leagueId);

    const teams = await this.prisma.team.findMany({
      where: { leagueId },
      select: { id: true, name: true, abbr: true, logo: true },
      orderBy: { name: 'asc' },
    });

    // Team Salary is everything committed this year: contracts, dead money
    // and cap holds (Article 1).
    const data = await Promise.all(
      teams.map(async (team) => {
        const [years, dead, holds] = await Promise.all([
          this.prisma.contractYear.aggregate({
            where: {
              seasonStartYear,
              contract: { leagueId, teamId: team.id, isActive: true },
            },
            _sum: { capHit: true },
          }),
          this.prisma.deadMoney.aggregate({
            where: { leagueId, teamId: team.id, seasonStartYear },
            _sum: { amount: true },
          }),
          this.prisma.capHold.aggregate({
            where: { leagueId, teamId: team.id, seasonStartYear },
            _sum: { amount: true },
          }),
        ]);

        const teamSalary =
          (years._sum.capHit ?? 0) +
          (dead._sum.amount ?? 0) +
          (holds._sum.amount ?? 0);

        const status = await this.hardCapService.statusFor(
          leagueId,
          team.id,
          seasonStartYear,
          teamSalary,
        );

        return { team, teamSalary, ...status };
      }),
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Hard caps retrieved successfully',
      data: { seasonStartYear, teams: data },
    });
  }
}
