import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * A commissioner correcting what the feed cannot supply.
 *
 * Bird years are a league fact — Rule 9.1 counts them from seasons under
 * contract in this league — so they live on `LeaguePlayer` and are edited per
 * league. Years of service is a fact about the player, and balldontlie
 * publishes no experience field on any tier, so AVORA counts it from completed
 * seasons with a game played and a commissioner corrects it when that count is
 * wrong — a draft-and-stash year, or a season missed through injury.
 *
 * Either may be sent on its own.
 */
export class EditPlayerServiceDto {
  /** Rule 9.1 — capped at three, which is Full Bird. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  birdYears?: number;

  /** Nobody has played more than about 23 seasons; 30 is room to spare. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  yearsOfService?: number;
}
