import { Type } from 'class-transformer';
import {
  FreeAgencyStyle,
  HardCapThreshold,
  LeagueSetupMode,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

const MAX_MONEY = 2_000_000_000;
const MAX_ROSTER = 60;
const MAX_SLOT = 30;

export class UpdateLeagueSettingsDto {
  @IsOptional()
  @IsEnum(LeagueSetupMode)
  setupMode?: LeagueSetupMode;

  @IsOptional()
  @IsEnum(FreeAgencyStyle)
  freeAgencyStyle?: FreeAgencyStyle;

  @IsOptional()
  @IsBoolean()
  salaryMatching?: boolean;

  @IsOptional()
  @IsBoolean()
  apronRules?: boolean;

  @IsOptional()
  @IsBoolean()
  allowTradeExceptions?: boolean;

  @IsOptional()
  @IsBoolean()
  allowTradingTradeExceptions?: boolean;

  @IsOptional()
  @IsBoolean()
  allowDraftPickTrading?: boolean;

  @IsOptional()
  @IsBoolean()
  commissionerTradeApproval?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1_000_000)
  @Max(MAX_MONEY)
  salaryCap?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  minPlayerSalary?: number;

  @IsOptional()
  @IsBoolean()
  hardCapEnabled?: boolean;

  @IsOptional()
  @IsEnum(HardCapThreshold)
  hardCapThreshold?: HardCapThreshold;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ROSTER)
  minRosterSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ROSTER)
  maxRosterSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ROSTER)
  maxTwoWay?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SLOT)
  slotGuard?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SLOT)
  slotForward?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SLOT)
  slotCenter?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SLOT)
  slotFlex?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SLOT)
  slotBench?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SLOT)
  slotIr?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(240)
  pregameLockMinutes?: number;
}
