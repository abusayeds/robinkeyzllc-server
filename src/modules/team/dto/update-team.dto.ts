import { Conference } from '@prisma/client';
import {
  IsEnum,
  IsHexColor,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 4)
  abbr?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  // Which half of the league this team plays in. The standings split on it,
  // and a league that does not use conferences simply leaves everyone east.
  @IsOptional()
  @IsEnum(Conference)
  conference?: Conference;

  // Free text, because a league names its own divisions. Null clears it, and
  // then the standings fall back to the conference.
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(40)
  division?: string | null;

  // null clears the logo, so the check is skipped for it.
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500)
  logo?: string | null;
}
