import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DraftFormat, DraftStatus } from '@prisma/client';

export class UpdateDraftDto {
  /** Startup drafts run long; a rookie draft is usually two. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  rounds?: number;

  /** The page's single switch. `format` is accepted too, for completeness. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  snakeOrder?: boolean;

  @IsOptional()
  @IsEnum(DraftFormat)
  format?: DraftFormat;

  /** The round a snake order first turns around in. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  reversalRound?: number;

  /** An instant, so the clock means the same thing to every owner. */
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  /** The zone it was entered in, kept because the label is part of the setting. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  /**
   * Seconds allowed per pick. A startup draft commonly runs on an eight-hour
   * clock, so the ceiling is a day rather than minutes.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(86400)
  pickSeconds?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  autoSetOrder?: boolean;

  @IsOptional()
  @IsEnum(DraftStatus)
  status?: DraftStatus;
}
