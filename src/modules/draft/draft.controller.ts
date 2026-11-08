import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { DraftKind } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LeagueAuth } from '../../common/decorators/league-auth.decorator';
import { AppError } from '../../common/errors/appError';
import { leagueRole } from '../../utils/role';
import { sendResponse } from '../../utils/sendResponse';
import { DraftPicksService } from './draft.picks.service';
import { DraftService } from './draft.service';
import { GeneratePicksDto } from './dto/generate-picks.dto';
import { ListPoolDto } from './dto/list-pool.dto';
import { ReassignPickDto } from './dto/reassign-pick.dto';
import { SetDraftOrderDto } from './dto/set-draft-order.dto';
import { SetPickProtectionDto } from './dto/set-pick-protection.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';

/** Writing to a draft is a commissioner's job; reading it is league business. */
const MANAGERS = [leagueRole.commissioner, leagueRole.coCommissioner] as const;

/**
 * `kind` arrives in the path as a word, so it is checked here rather than
 * trusted: an unknown value would otherwise reach Prisma as a bad enum.
 */
function parseKind(value: string): DraftKind {
  if (value === DraftKind.startup || value === DraftKind.rookie) return value;
  throw new AppError(
    HttpStatus.BAD_REQUEST,
    'A draft is either "startup" or "rookie".',
  );
}

@Controller('leagues/:leagueId')
export class DraftController {
  constructor(
    private readonly draftService: DraftService,
    private readonly picksService: DraftPicksService,
  ) {}

  // ---------------------------------------------------------------- picks

  @Get('draft-picks')
  @LeagueAuth()
  async inventory(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
  ) {
    const data = await this.picksService.inventory(leagueId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Draft picks retrieved successfully',
      data,
    });
  }

  // Declared before ':pickId', or 'generate' is read as an id.
  @Post('draft-picks/generate')
  @LeagueAuth(...MANAGERS)
  async generate(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Body() body: GeneratePicksDto,
  ) {
    const data = await this.picksService.generate(leagueId, body.rounds ?? 2);

    sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Draft picks created successfully',
      data,
    });
  }

  @Patch('draft-picks/:pickId/reassign')
  @LeagueAuth(...MANAGERS)
  async reassign(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('pickId', ParseIntPipe) pickId: number,
    @Body() body: ReassignPickDto,
    @CurrentUser('id') userId: number,
  ) {
    await this.picksService.reassign(leagueId, pickId, body, userId);
    const data = await this.picksService.inventory(leagueId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Draft pick reassigned successfully',
      data,
    });
  }

  @Patch('draft-picks/:pickId')
  @LeagueAuth(...MANAGERS)
  async setProtection(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('pickId', ParseIntPipe) pickId: number,
    @Body() body: SetPickProtectionDto,
  ) {
    await this.picksService.setProtection(leagueId, pickId, body);
    const data = await this.picksService.inventory(leagueId);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Draft pick updated successfully',
      data,
    });
  }

  // ---------------------------------------------------------------- drafts

  @Get('drafts/:kind')
  @LeagueAuth()
  async getDraft(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('kind') kind: string,
  ) {
    const data = await this.draftService.get(leagueId, parseKind(kind));

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Draft settings retrieved successfully',
      data,
    });
  }

  @Patch('drafts/:kind')
  @LeagueAuth(...MANAGERS)
  async updateDraft(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('kind') kind: string,
    @Body() body: UpdateDraftDto,
  ) {
    const data = await this.draftService.update(
      leagueId,
      parseKind(kind),
      body,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Draft settings saved successfully',
      data,
    });
  }

  @Put('drafts/:kind/order')
  @LeagueAuth(...MANAGERS)
  async setOrder(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('kind') kind: string,
    @Body() body: SetDraftOrderDto,
  ) {
    const data = await this.draftService.setOrder(
      leagueId,
      parseKind(kind),
      body,
    );

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Draft order saved successfully',
      data,
    });
  }

  /** Lays the order out from the team list, shuffling it first if asked. */
  @Post('drafts/:kind/order/build')
  @LeagueAuth(...MANAGERS)
  async buildOrder(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('kind') kind: string,
    @Query('randomize') randomize?: string,
  ) {
    const data = await this.draftService.buildOrder(leagueId, parseKind(kind), {
      randomize: randomize === 'true',
    });

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message:
        randomize === 'true'
          ? 'Draft order randomized successfully'
          : 'Draft order built successfully',
      data,
    });
  }

  @Get('drafts/:kind/pool')
  @LeagueAuth()
  async pool(
    @Res() res: Response,
    @Param('leagueId', ParseIntPipe) leagueId: number,
    @Param('kind') kind: string,
    @Query() query: ListPoolDto,
  ) {
    const data = await this.draftService.pool(leagueId, parseKind(kind), query);

    sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Draft pool retrieved successfully',
      data,
    });
  }
}
