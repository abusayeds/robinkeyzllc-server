import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ContractType, SignedVia } from '@prisma/client';

export class SubmitOfferDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  leaguePlayerId!: number;

  // The CBA caps a contract at five years; nothing here needs to allow more.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  years!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  firstYearSalary!: number;

  /** Whole percent of the first year added to each later season. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8)
  raisePct?: number;

  @IsOptional()
  @IsEnum(ContractType)
  contractType?: ContractType;

  @IsOptional()
  @IsEnum(SignedVia)
  signedVia?: SignedVia;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
