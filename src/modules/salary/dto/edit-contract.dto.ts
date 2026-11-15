import { Type } from 'class-transformer';
import { ContractOptionType, GuaranteeType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

export class EditContractYearDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  seasonStartYear!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  salary!: number;

  /**
   * Left out, the cap hit follows the salary. A two-way deal is the case where
   * they differ, and the service keeps that one at zero whatever is sent.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  capHit?: number;

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
}

/**
 * A commissioner correcting one contract.
 *
 * Only the seasons sent are touched, so a fix to a single year does not have
 * to restate the rest of the deal.
 */
export class EditContractDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => EditContractYearDto)
  years!: EditContractYearDto[];
}
