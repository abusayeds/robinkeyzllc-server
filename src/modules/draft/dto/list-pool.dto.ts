import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListPoolDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // The commissioner pages through the pool a screen at a time, but a live
  // draft room asks for all of it at once: it sorts by last season, filters by
  // position and counts what is left, and it cannot do any of those honestly
  // over one page. A startup pool is every active NBA player, so the ceiling
  // has to clear that.
  @Max(600)
  limit?: number;

  /** Shows players already on a roster too, which the preview counts need. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeDrafted?: boolean;
}
