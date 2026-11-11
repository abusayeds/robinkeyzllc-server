import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auth } from '../../common/decorators/auth.decorator';
import { role } from '../../utils/role';
import { sendResponse } from '../../utils/sendResponse';
import { PlatformService } from './platform.service';

// Platform-wide, so none of this is scoped to a league and none of it goes
// through the league guard.
@Controller('platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('overview')
  @Auth(role.superAdmin)
  async overview(@Res() res: Response) {
    const data = await this.platformService.overview();

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Platform overview retrieved successfully',
      data,
    });
  }
}
