import { Type } from 'class-transformer';
import { ContractOptionType, GuaranteeType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** One season of one player's real NBA contract. */
export class ContractReferenceYearDto {
  /**
   * The player, by his balldontlie id. Named that way because whoever loads
   * this file has the feed's ids, not this database's.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bdlPlayerId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  seasonStartYear!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  salary!: number;

  @IsOptional()
  @IsEnum(ContractOptionType)
  optionType?: ContractOptionType | null;

  @IsOptional()
  @IsEnum(GuaranteeType)
  guaranteeType?: GuaranteeType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  guaranteedAmount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  endSeasonStartYear?: number;

  @IsOptional()
  @IsString()
  source?: string;
}

/**
 * The global contract database, loaded by the Super Admin.
 *
 * balldontlie publishes no contract endpoint, so these cannot be synced from
 * it. A Startup league reads this table when a player is drafted, which is
 * what makes the figures the same in every league.
 */
export class ContractReferenceDto {
  @IsArray()
  @ArrayMinSize(1)
  // A ceiling so one request cannot try to load a whole league's worth of
  // seasons at once; the caller sends it in batches.
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ContractReferenceYearDto)
  rows!: ContractReferenceYearDto[];
}
