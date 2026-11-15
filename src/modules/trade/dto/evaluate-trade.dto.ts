import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { TradeAssetDto } from './propose-trade.dto';

/**
 * A trade the user is still putting together.
 *
 * Unlike a proposal this one is allowed to be incomplete — no assets at all,
 * or only one team sending — because the builder asks on every change and the
 * answer to "is this legal yet" is the point. The teams are listed separately
 * for the same reason: a card is on screen before anything has been picked
 * from it, and it still has cap numbers to show.
 */
export class EvaluateTradeDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  teamIds!: number[];

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => TradeAssetDto)
  assets!: TradeAssetDto[];
}
