import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/**
 * How a row's player is settled: either the commissioner names the player it
 * really meant, or asks for one to be created from the name in the file
 * because the NBA feed has nobody by it.
 */
export class ResolveImportRowDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  playerId?: number;

  /** Creates a league-only player from the row's own name. */
  @IsOptional()
  @IsBoolean()
  createPlayer?: boolean;
}
