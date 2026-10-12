import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class forgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class verifyOtpDto {
  @IsString()
  @IsNotEmpty()
  otp!: string;
}

export class resetPasswordDto {
  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;
}

export class changePasswordDto {
  @IsString()
  @IsNotEmpty()
  oldPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;
}
