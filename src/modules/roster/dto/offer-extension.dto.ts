import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

export class ExtensionYearDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  seasonStartYear!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  salary!: number;

  /**
   * Rule 10.6 — player and team options only, and the service refuses one on
   * any year but the last.
   */
  @IsOptional()
  @IsIn(['player', 'team', null])
  optionType?: 'player' | 'team' | null;
}

export class OfferExtensionDto {
  @IsArray()
  @ArrayMinSize(1)
  // Rule 10.4 caps the length at five; the service enforces the real limit for
  // this player, and this only stops an absurd request reaching it.
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ExtensionYearDto)
  years!: ExtensionYearDto[];
}
