import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A commissioner writing a Traded Player Exception by hand.
 *
 * Article 7 creates an exception from a trade, and `process()` writes those
 * itself. This is for the ones that do not come from a trade processed here —
 * a league moving in from somewhere else, or a deal the commissioner settled
 * outside the app — which otherwise could not be recorded at all.
 */
export class CreateTradeExceptionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teamId!: number;

  /** What it is worth. Rule 7.1 sizes it from the salary the team sent out. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  /**
   * How much is left, when the exception has already been used in part. Left
   * out, it starts at its full value.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  remaining?: number;

  /** Rule 7.2 — one year from the trade that created it, unless stated. */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  /** What it reads as in a trade: "Porzingis TPE", say. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}
