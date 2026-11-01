import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DraftType, LeagueVisibility, ScoringType } from '@prisma/client';

export class CreateLeagueDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsString()
  @IsOptional()
  logo?: string;

  // An even count keeps every week's schedule pairable without a bye.
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(30)
  @IsOptional()
  teamCount?: number;

  @IsEnum(ScoringType)
  @IsOptional()
  scoringType?: ScoringType;

  @IsEnum(DraftType)
  @IsOptional()
  draftType?: DraftType;

  @IsEnum(LeagueVisibility)
  @IsOptional()
  visibility?: LeagueVisibility;
}
