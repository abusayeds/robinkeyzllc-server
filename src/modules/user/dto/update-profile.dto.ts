import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class updateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // A stored path from POST /upload, or null to clear the picture.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  image?: string | null;
}
