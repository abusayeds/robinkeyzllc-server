import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PickProtectionOutcome, TradeAssetKind } from '@prisma/client';

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

  // Rule 12.5 — the pick changes hands only if it falls outside the top N of
  // its round. Left out, or zero, means unprotected. The ceiling is the first
  // round's own size, which the service checks against the league's settings.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  protectedTopN?: number;

  // Rule 12.6 — what happens in the year the protection holds. Required once
  // a protection is set, because a protection with no outcome leaves the
  // obligation undefined.
  @IsOptional()
  @IsEnum(PickProtectionOutcome)
  protectionOutcome?: PickProtectionOutcome;

  // Rule 12.7 — a rollover must name the year the pick finally conveys
  // unprotected.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  protectionFinalYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  protectionNote?: string;
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
