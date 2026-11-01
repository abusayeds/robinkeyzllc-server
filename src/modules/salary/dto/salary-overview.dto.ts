import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SalaryOverviewDto {
  /**
   * The season to read, as the year it starts in. Left out to use the
   * league's current season.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1946)
  @Max(2200)
  season?: number;
}
