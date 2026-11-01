import { LeagueVisibility } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateLeagueDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  // A stored path from POST /upload, or null to clear the logo.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  logo?: string | null;

  @IsOptional()
  @IsEnum(LeagueVisibility)
  visibility?: LeagueVisibility;
}
