import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GeneratePicksDto {
  /** How many rounds of picks each draft in the window has. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  rounds?: number;
}
