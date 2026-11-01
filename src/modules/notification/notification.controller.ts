import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { sendResponse } from 'src/utils/sendResponse';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { listNotificationDto } from './dto/list-notification.dto';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @Auth()
  async list(
    @Res() res: Response,
    @CurrentUser('id') userId: number,
    @Query() query: listNotificationDto,
  ) {
    const result = await this.notificationService.listDB(userId, query);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Notifications retrieved successfully',
      pagination: result.pagination,
      data: result.data,
    });
  }

  @Get('unread-count')
  @Auth()
  async unreadCount(
    @Res() res: Response,
    @CurrentUser('id') userId: number,
    @Query() query: listNotificationDto,
  ) {
    const data = await this.notificationService.unreadCountDB(
      userId,
      query.leagueId,
    );
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Unread count retrieved successfully',
      data,
    });
  }

  @Patch('read-all')
  @Auth()
  async markAllRead(
    @Res() res: Response,
    @CurrentUser('id') userId: number,
    @Query() query: listNotificationDto,
  ) {
    const data = await this.notificationService.markAllReadDB(
      userId,
      query.leagueId,
    );
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'All notifications marked as read',
      data,
    });
  }

  @Patch(':id/read')
  @Auth()
  async markRead(
    @Res() res: Response,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const data = await this.notificationService.markReadDB(userId, id);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Notification marked as read',
      data,
    });
  }
}
