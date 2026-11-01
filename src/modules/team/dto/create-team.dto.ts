import {
  IsHexColor,
  IsOptional,
  IsString,
  Length,
  MaxLength,
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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logo?: string;
}
