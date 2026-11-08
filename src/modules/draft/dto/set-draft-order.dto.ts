import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

export class DraftOrderSlotDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  round!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  pickInRound!: number;

  /** Its place in the running order. Taken from the list position if absent. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  overall?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  teamId!: number;

  /** The pick asset used here, when the slot comes from the inventory. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  draftPickId?: number;
}

export class SetDraftOrderDto {
  // 30 teams across 30 rounds is the most a league can ask for, and a cap
  // keeps one bad request from writing a million rows.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(900)
  @ValidateNested({ each: true })
  @Type(() => DraftOrderSlotDto)
  order!: DraftOrderSlotDto[];
}
