import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ReassignPickDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toTeamId!: number;

  /** The trade reference or the commissioner's own note, kept on the pick. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
