import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class MakePickDto {
  /**
   * The player being taken. The slot is not sent: it is always the first
   * unpicked one, so a client cannot aim a pick at a seat further down the
   * board.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  playerId!: number;
}
