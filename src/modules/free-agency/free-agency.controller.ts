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
import { ListOffersDto } from './dto/list-offers.dto';
import { PoolDto } from './dto/pool.dto';
import { SubmitOfferDto } from './dto/submit-offer.dto';
import { FreeAgencyService } from './free-agency.service';

@Controller('leagues/:leagueId/free-agency')
export class FreeAgencyController {
  constructor(private readonly freeAgencyService: FreeAgencyService) {}

  // Offers are public within the league: a team deciding what to bid needs to
  // see what it is bidding against.
  @Get('offers')
  @LeagueAuth()
  async list(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Query() query: ListOffersDto,
  ) {
    const data = await this.freeAgencyService.list(leagueId, query.status);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Offers retrieved successfully',
      data,
    });
  }

  // The pool, plus what the asking team has to spend. teamId is optional:
  // a commissioner browsing has no team of their own to budget against.
  @Get('players')
  @LeagueAuth()
  async pool(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Query() query: PoolDto,
  ) {
    const data = await this.freeAgencyService.pool(leagueId, query.teamId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Free agents retrieved successfully',
      data,
    });
  }

  // The offering team is named in the path rather than read from the signed-in
  // user, because a commissioner may enter an offer on a team's behalf.
  @Post('teams/:teamId/offers')
  @LeagueAuth()
  async submit(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
    @CurrentUser('id') userId: number,
    @Body() payload: SubmitOfferDto,
  ) {
    const data = await this.freeAgencyService.submit(
      leagueId,
      teamId,
      userId,
      payload,
    );

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Offer submitted successfully',
      data,
    });
  }

  @Post('offers/:offerId/withdraw')
  @LeagueAuth()
  async withdraw(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('offerId', ParseIntPipe) offerId: number,
  ) {
    const data = await this.freeAgencyService.withdraw(leagueId, offerId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Offer withdrawn successfully',
      data,
    });
  }

  // Accepting writes a contract and moves a player, so it stays with the
  // commissioner until the league decides who else may sign one.
  @Post('offers/:offerId/accept')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async accept(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('offerId', ParseIntPipe) offerId: number,
  ) {
    const data = await this.freeAgencyService.accept(leagueId, offerId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Offer accepted successfully',
      data,
    });
  }

  @Post('offers/:offerId/decline')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async decline(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('offerId', ParseIntPipe) offerId: number,
  ) {
    const data = await this.freeAgencyService.decline(leagueId, offerId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Offer declined successfully',
      data,
    });
  }
}
