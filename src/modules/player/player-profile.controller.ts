import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { sendResponse } from '../../utils/sendResponse';
import { PlayerProfileService } from './player-profile.service';

// Separate from `PlayerController`, which is mounted on 'players' and carries
// @Auth(): a profile is half league data — his contract, his bird years — so it
// is read through the league and guarded by @LeagueAuth().
@Controller('leagues/:leagueId/players')
export class PlayerProfileController {
  constructor(private readonly playerProfileService: PlayerProfileService) {}

  // Every member can open any player's card. A roster is not private within a
  // league, and the draft board asks about players no team holds.
  @Get(':playerId/profile')
  @LeagueAuth()
  async profile(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('playerId', ParseIntPipe) playerId: number,
  ) {
    const data = await this.playerProfileService.profile(leagueId, playerId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Player profile retrieved successfully',
      data,
    });
  }
}
