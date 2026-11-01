import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class PoolDto {
  /** The team doing the shopping, so the response can budget against it. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teamId?: number;
}
