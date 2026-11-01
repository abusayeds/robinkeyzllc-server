import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { sendResponse } from '../../utils/sendResponse';
import { SalaryOverviewDto } from './dto/salary-overview.dto';
import { SalaryService } from './salary.service';

@Controller('leagues/:leagueId/salaries')
export class SalaryController {
  constructor(private readonly salaryService: SalaryService) {}

  // Declared before the ':teamId' style routes would be, and before anything
  // that could read "outlook" as an id.
  @Get('outlook/:teamId')
  @LeagueAuth()
  async outlook(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('teamId', ParseIntPipe) teamId: number,
  ) {
    const data = await this.salaryService.outlook(leagueId, teamId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Payroll outlook retrieved successfully',
      data,
    });
  }

  // Cap figures are league-wide information: every member can see what each
  // team has committed, which is the point of a cap sheet.
  @Get()
  @LeagueAuth()
  async overview(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Query() query: SalaryOverviewDto,
  ) {
    const data = await this.salaryService.overview(leagueId, query.season);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Salaries retrieved successfully',
      data,
    });
  }
}
