import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { LeagueContentType } from '@prisma/client';
import type { Response } from 'express';
import { sendResponse } from 'src/utils/sendResponse';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { leagueRole, role } from '../../utils/role';
import { saveLeagueContentDto } from './dto/league-content.dto';
import { crateManagementDto } from './dto/management.dto';
import { managementService } from './management.service';

@Controller('management')
export class managementController {
  constructor(private readonly managementService: managementService) {}

  @Post('create')
  @Auth(role.superAdmin)
  async managementCreate(
    @Res() res: Response,
    @Body() payload: crateManagementDto,
  ) {
    const data = await this.managementService.managementCreateDB(payload);
    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: `${payload.type.charAt(0).toUpperCase() + payload.type.slice(1)} description updated successfully.`,
      data: data,
    });
  }

  @Get()
  async managementGetAll(@Res() res: Response, @Query('type') type: string) {
    const data = await this.managementService.managementGetAllDB(type);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'data fetched successfully',
      data: data,
    });
  }

  @Get('list')
  @Auth(role.superAdmin)
  async managementList(
    @Res() res: Response,
    @Query() query: Record<string, unknown>,
  ) {
    const result = await this.managementService.managementListDB(query);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'data fetched successfully',
      pagination: result.pagination,
      data: result.data,
    });
  }

  // League scoped content. The same four pages, written per league by its
  // commissioner. Declared after the platform routes so 'list' is not read as
  // a league id.
  @Get('league/:leagueId')
  @LeagueAuth()
  async leagueContentList(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const data = await this.managementService.leagueContentListDB(leagueId);
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League content retrieved successfully',
      data,
    });
  }

  @Get('league/:leagueId/:type')
  @LeagueAuth()
  async leagueContentGet(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('type', new ParseEnumPipe(LeagueContentType))
    type: LeagueContentType,
  ) {
    const data = await this.managementService.leagueContentGetDB(
      leagueId,
      type,
    );
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League content retrieved successfully',
      data,
    });
  }

  @Put('league/:leagueId/:type')
  @LeagueAuth(leagueRole.commissioner, leagueRole.coCommissioner)
  async leagueContentSave(
    @Res() res: Response,
    @CurrentUser('id') userId: number,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('type', new ParseEnumPipe(LeagueContentType))
    type: LeagueContentType,
    @Body() payload: saveLeagueContentDto,
  ) {
    const data = await this.managementService.leagueContentSaveDB(
      leagueId,
      type,
      payload,
      userId,
    );
    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'League content updated successfully',
      data,
    });
  }
}
