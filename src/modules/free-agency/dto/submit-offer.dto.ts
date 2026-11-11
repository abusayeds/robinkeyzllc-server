import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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

  /**
   * Rule 10.1 — what each season is guaranteed for, in season order.
   *
   * Only read for a partially guaranteed offer. The length has to match
   * `years` and each figure has to fit inside that season's salary; both are
   * checked in the service, where the salaries are known.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  guaranteedAmounts?: number[];

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
