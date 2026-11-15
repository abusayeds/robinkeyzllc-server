import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ListOnTradeBlockDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  leaguePlayerId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
