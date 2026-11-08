import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PickProtectionOutcome } from '@prisma/client';

/**
 * Rules 12.5-12.7. Sending `protectedTopN: null` clears the protection and
 * everything that hangs off it.
 */
export class SetPickProtectionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  protectedTopN?: number | null;

  @IsOptional()
  @IsEnum(PickProtectionOutcome)
  protectionOutcome?: PickProtectionOutcome;

  /** Rule 12.7 — a rollover must name its final year. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  protectionFinalYear?: number | null;

  /** Rule 12.6 — the pick a conversion turns into. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  convertsToPickId?: number | null;

  /** Who the obligation points at while the protection holds. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owedToTeamId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  /**
   * Rule 8.13 — a frozen pick that has to be placed at the end of the first
   * round. Only the commissioner can say so, and only for a frozen pick.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  movedToEndOfRound?: boolean;
}
