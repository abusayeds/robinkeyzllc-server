import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { leagueRole } from '../../utils/role';
import { sendResponse } from '../../utils/sendResponse';
import { ListTradesDto } from './dto/list-trades.dto';
import { ProposeTradeDto } from './dto/propose-trade.dto';
import { RejectTradeDto } from './dto/reject-trade.dto';
import { TradeService } from './trade.service';

@Controller('leagues/:leagueId/trades')
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  // Trades are league business: everyone can see what has been proposed, and
  // the trade finder depends on it.
  @Get()
  @LeagueAuth()
  async list(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Query() query: ListTradesDto,
  ) {
    const data = await this.tradeService.list(
      leagueId,
      query.status,
      query.teamId,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Trades retrieved successfully',
      data,
    });
  }

  // Declared before ':tradeId', or 'exceptions' is read as an id.
  @Get('exceptions')
  @LeagueAuth()
  async exceptions(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Query('teamId') teamId?: string,
  ) {
    const data = await this.tradeService.exceptions(
      leagueId,
      teamId ? Number(teamId) : undefined,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Trade exceptions retrieved successfully',
      data,
    });
  }

  @Get(':tradeId')
  @LeagueAuth()
  async findOne(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('tradeId', ParseIntPipe) tradeId: number,
  ) {
    const data = await this.tradeService.findOne(leagueId, tradeId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Trade retrieved successfully',
      data,
    });
  }

  // @LeagueAuth() proves membership only. Whether this caller holds one of
  // the teams is the service's question.
  @Post()
  @LeagueAuth()
  async propose(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @CurrentUser('id') userId: number,
    @Body() payload: ProposeTradeDto,
  ) {
    const data = await this.tradeService.propose(leagueId, userId, payload);

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Trade proposed successfully',
      data,
    });
  }

  @Post(':tradeId/teams/:teamId/accept')
  @LeagueAuth()
  async accept(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('tradeId', ParseIntPipe) tradeId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.tradeService.respond(
      leagueId,
      tradeId,
      teamId,
      userId,
      true,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Trade accepted successfully',
      data,
    });
  }

  @Post(':tradeId/teams/:teamId/decline')
  @LeagueAuth()
  async decline(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('tradeId', ParseIntPipe) tradeId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.tradeService.respond(
      leagueId,
      tradeId,
      teamId,
      userId,
      false,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Trade declined successfully',
      data,
    });
  }

  @Post(':tradeId/withdraw')
  @LeagueAuth()
  async withdraw(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('tradeId', ParseIntPipe) tradeId: number,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.tradeService.withdraw(leagueId, tradeId, userId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Trade withdrawn successfully',
      data,
    });
  }

  // Approval is the commissioner's, by definition: the setting reads
  // "Commissioner must approve trades before they are processed."
  @Post(':tradeId/approve')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async approve(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('tradeId', ParseIntPipe) tradeId: number,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.tradeService.approve(leagueId, tradeId, userId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Trade approved and processed successfully',
      data,
    });
  }

  @Post(':tradeId/reject')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async reject(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('tradeId', ParseIntPipe) tradeId: number,
    @CurrentUser('id') userId: number,
    @Body() payload: RejectTradeDto,
  ) {
    const data = await this.tradeService.reject(
      leagueId,
      tradeId,
      userId,
      payload.reason,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Trade rejected successfully',
      data,
    });
  }
}
