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
import { CapYearDto } from './dto/cap-year.dto';
import { CapService } from './cap.service';

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
}

// What one league's figures actually are, which every member may see.
@Controller('leagues/:leagueId/cap')
export class LeagueCapController {
  constructor(
    private readonly capService: CapService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @LeagueAuth()
  async effective(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const league = await this.prisma.league.findUnique({
      where: { id: leagueId },
      select: { season: true },
    });
    const seasonStartYear =
      (league ? parseSeasonLabel(league.season) : null) ??
      new Date().getUTCFullYear();

    const data = await this.capService.forLeague(leagueId, seasonStartYear);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Cap figures retrieved successfully',
      data,
    });
  }
}
