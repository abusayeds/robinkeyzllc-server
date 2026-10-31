import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { sendResponse } from '../../utils/sendResponse';
import { InviteService } from './invite.service';

/**
 * The invited user's side. These carry @Auth() and not @LeagueAuth(), because
 * the whole point is that the user is not a member of that league yet —
 * LeagueGuard would reject them before they could ever accept. Ownership of
 * the invite is what authorises the call.
 */
@Controller('invites')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  @Get('my')
  @Auth()
  async listMine(
    @Res() res: Response,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.inviteService.listMine(userId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Pending invites retrieved successfully',
      data,
    });
  }

  @Post(':inviteId/accept')
  @Auth()
  async accept(
    @Res() res: Response,
    @Param('inviteId', ParseIntPipe) inviteId: number,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.inviteService.accept(inviteId, userId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Invite accepted successfully',
      data,
    });
  }

  @Post(':inviteId/decline')
  @Auth()
  async decline(
    @Res() res: Response,
    @Param('inviteId', ParseIntPipe) inviteId: number,
    @CurrentUser('id') userId: number,
  ) {
    const data = await this.inviteService.decline(inviteId, userId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Invite declined successfully',
      data,
    });
  }
}
