import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { TradeStatus } from '@prisma/client';

export class ListTradesDto {
  @IsOptional()
  @IsEnum(TradeStatus)
  status?: TradeStatus;

  /** Narrows to trades one team is part of. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teamId?: number;
}
