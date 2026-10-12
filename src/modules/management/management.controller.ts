import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { sendResponse } from 'src/utils/sendResponse';
import { Auth } from '../../common/decorators/auth.decorator';
import { role } from '../../utils/role';
import { crateManagementDto } from './dto/management.dto';
import { managementService } from './management.service';

@Controller('management')
export class managementController {
  constructor(private readonly managementService: managementService) {}

  @Post('create')
  @Auth(role.admin)
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
  @Auth(role.admin)
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
}
