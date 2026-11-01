import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class SearchUserDto {
  @IsString()
  @Length(2, 60)
  q!: string;

  /** When given, each hit says whether that user is already in this league. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  leagueId?: number;
}
