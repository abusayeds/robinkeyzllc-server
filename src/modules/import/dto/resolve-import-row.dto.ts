import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** The player the commissioner says this row really meant. */
export class ResolveImportRowDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  playerId!: number;
}
