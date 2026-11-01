import {
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

  // null clears the logo, so the check is skipped for it.
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500)
  logo?: string | null;
}
