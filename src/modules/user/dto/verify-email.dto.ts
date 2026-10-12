import { IsNotEmpty, IsString } from 'class-validator';

export class verifyEmailDto {
  @IsString()
  @IsNotEmpty()
  otp!: string;
}
