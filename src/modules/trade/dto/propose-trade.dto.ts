import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TradeAssetKind } from '@prisma/client';

export class TradeAssetDto {
  @IsEnum(TradeAssetKind)
  kind!: TradeAssetKind;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  fromTeamId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  toTeamId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  leaguePlayerId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tradeExceptionId?: number;

  // Article 12 — a future pick is an asset in its own right in a dynasty
  // league. Whether this particular one may move is Rule 12.11's question,
  // and the service asks it rather than trusting the client.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  draftPickId?: number;
}

export class ProposeTradeDto {
  @IsArray()
  @ArrayMinSize(1)
  // A cap so one request cannot try to move a whole league at once.
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => TradeAssetDto)
  assets!: TradeAssetDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
