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

export class CreateTeamDto {
  @IsString()
  @Length(2, 60)
  name!: string;

  @IsString()
  @Length(2, 4)
  abbr!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  // Which half of the league this team plays in. The Add Team form has
  // offered this since it was built and the create DTO did not accept it, so
  // a whitelisting pipe refused the whole request with "property conference
  // should not exist" and no team could be created at all. Left out, the
  // conferences still alternate as teams are added.
  @IsOptional()
  @IsEnum(Conference)
  conference?: Conference;

  // Free text, because a league names its own divisions. Left out or blank,
  // the standings group the team by its conference.
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(40)
  division?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logo?: string;
}
