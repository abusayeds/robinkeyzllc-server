import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { sendResponse } from '../../utils/sendResponse';
import { TransactionsService } from './transactions.service';

@Controller('leagues/:leagueId/transactions')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Every move in the league, newest first.
   *
   * The caller's own team is resolved here rather than asked for, so the
   * screen's "My Trade History" filter cannot be pointed at somebody else's.
   */
  @Get()
  @LeagueAuth()
  async feed(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @CurrentUser('id') userId: number,
    @Query('take') take?: string,
  ) {
    const membership = await this.prisma.teamMember.findFirst({
      where: { leagueId, userId },
      select: { teamId: true },
    });

    const parsed = Number(take);
    const limit =
      Number.isInteger(parsed) && parsed > 0 && parsed <= 200 ? parsed : 50;

    const data = await this.transactionsService.feed(leagueId, {
      teamId: membership?.teamId ?? null,
      take: limit,
    });

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Transactions retrieved successfully',
      data: {
        myTeamId: membership?.teamId ?? null,
        transactions: data,
      },
    });
  }
}
