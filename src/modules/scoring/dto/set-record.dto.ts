import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * A record an owner brings over from wherever their league actually plays.
 *
 * The ceiling is high rather than tight: a league's season length is its own
 * business, and the only genuinely wrong value is a negative one.
 */
export class SetTeamRecordDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  wins!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  losses!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  ties!: number;
}
