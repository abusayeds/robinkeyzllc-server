import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  isString,
  IsString,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';
export class createUserDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  phone!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}
