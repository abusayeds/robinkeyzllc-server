import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class createUserDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  // Avora collects a Discord username at sign-up and uses it as the display
  // name, so no separate name field is asked for.
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
