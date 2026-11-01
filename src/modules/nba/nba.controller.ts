import { Controller, Get, HttpStatus, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auth } from '../../common/decorators/auth.decorator';
import { role } from '../../utils/role';
import { sendResponse } from '../../utils/sendResponse';
import { NbaSyncService } from './nba-sync.service';

// NBA data is global: it belongs to the platform, not to a league, so these
// are super admin routes rather than league ones.
@Controller('nba/sync')
export class NbaController {
  constructor(private readonly nbaSyncService: NbaSyncService) {}

  @Get('runs')
  @Auth(role.superAdmin)
  async runs(@Res() res: Response) {
    const data = await this.nbaSyncService.history();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Sync history retrieved successfully',
      data,
    });
  }

  @Post('teams')
  @Auth(role.superAdmin)
  async teams(@Res() res: Response) {
    const data = await this.nbaSyncService.syncTeams();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'NBA teams synced successfully',
      data,
    });
  }

  // `cursor` resumes a run that stopped part way; a failed run records the
  // one it reached.
  @Post('players')
  @Auth(role.superAdmin)
  async players(@Res() res: Response, @Query('cursor') cursor?: string) {
    const data = await this.nbaSyncService.syncPlayers(cursor);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'NBA players synced successfully',
      data,
    });
  }
}
