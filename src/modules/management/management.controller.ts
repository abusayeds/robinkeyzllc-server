import { managementService } from './management.service';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { crateManagementDto } from './dto/management.dto';
import type { Response } from 'express';
import { sendResponse } from 'src/utils/sendResponse';

@Controller('management')
export class managementController {
  constructor(private readonly managementService: managementService) {}
  // ===========  crate management  =============== //
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  async managementCreate(
    @Res() res: Response,
    @Body() payload: crateManagementDto,
  ) {
    const data = await this.managementService.managementCreateDB(payload);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'data crate successfully ',
      data: data,
    });
  }
  // ===========  crate management  =============== //
  @Get()
  @HttpCode(HttpStatus.OK)
  async managementGetAll(@Res() res: Response, @Query('type') type: string) {
    const data = await this.managementService.managementGetAllDB(type);
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'data fetched successfully',
      data: data,
    });
  }
}
