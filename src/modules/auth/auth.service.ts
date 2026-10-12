import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/appError';
import { OTP_PURPOSE, OtpService } from '../../common/otp/otp.service';
import { TAuthUser, TJwtUser } from '../../interface/auth.interface';
import {
  sendForgotPasswordOtpEmail,
  sendInBackground,
} from '../../utils/sendEmail';
import {
  changePasswordDto,
  forgotPasswordDto,
  resetPasswordDto,
  verifyOtpDto,
} from './dto/auth.dto';
import { loginUserDto } from './dto/login-user.dto';

@Injectable()
export class authService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly otpService: OtpService,
  ) {}

  async login(payload: loginUserDto) {
    const { email, password, isRememberMe } = payload;

    const user = await this.prisma.user.findUnique({ where: { email } });

    // Same message for "no such user" and "wrong password", otherwise an
    // attacker can discover which emails exist.
    if (!user || user.isDeleted) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Invalid credentials');
    }

    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (!isPasswordMatched) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Invalid credentials');
    }

    // Said only after the password checks out, so it leaks nothing.
    if (!user.isEmailVerified) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'Please verify your email before logging in.',
      );
    }

    const jwtUser: TJwtUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    const expiresIn = isRememberMe
      ? '30d'
      : (this.config.get<string>('JWT_EXPIRES_IN') ?? '7d');

    const token = await this.jwtService.signAsync(
      { user: jwtUser },
      { expiresIn: expiresIn as JwtSignOptions['expiresIn'] },
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
      },
    };
  }

  async forgotPassword(payload: forgotPasswordDto) {
    const { email } = payload;

    // Unverified accounts are rejected here, so a single email can never have
    // a registration OTP and a reset OTP pending at the same time.
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.isDeleted || !user.isEmailVerified) {
      throw new AppError(HttpStatus.NOT_FOUND, 'This account does not exist.');
    }

    const otp = await this.otpService.issue(email);
    const token = await this.otpService.signToken(email, OTP_PURPOSE.forgot);

    sendInBackground(
      () => sendForgotPasswordOtpEmail(otp, email),
      `password reset OTP to ${email}`,
    );

    return { token };
  }

  async verifyForgotPasswordOtp(payload: verifyOtpDto, rawToken: string) {
    const email = await this.otpService.readToken(
      rawToken,
      OTP_PURPOSE.forgot,
    );

    await this.otpService.verify(email, payload.otp);

    const token = await this.otpService.signToken(
      email,
      OTP_PURPOSE.verifyForgot,
    );
    return { token };
  }

  async resendOtp(rawToken: string) {
    const email = await this.otpService.readToken(
      rawToken,
      OTP_PURPOSE.forgot,
    );

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.isDeleted) {
      throw new AppError(HttpStatus.NOT_FOUND, 'This account does not exist.');
    }

    const otp = await this.otpService.issue(email);
    const token = await this.otpService.signToken(email, OTP_PURPOSE.forgot);

    sendInBackground(
      () => sendForgotPasswordOtpEmail(otp, email),
      `password reset OTP to ${email}`,
    );

    return { token };
  }

  async resetPassword(payload: resetPasswordDto, rawToken: string) {
    const email = await this.otpService.readToken(
      rawToken,
      OTP_PURPOSE.verifyForgot,
    );

    if (payload.password !== payload.confirmPassword) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Passwords do not match');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.isDeleted) {
      throw new AppError(HttpStatus.NOT_FOUND, 'User not found.');
    }

    const hashedPassword = await bcrypt.hash(payload.password, 10);
    await this.prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });

    return null;
  }

  async changePassword(payload: changePasswordDto, authUser: TAuthUser) {
    const { oldPassword, newPassword, confirmPassword } = payload;

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
    });
    if (!user) {
      throw new AppError(HttpStatus.NOT_FOUND, 'User not found.');
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Old password is incorrect.');
    }

    if (newPassword !== confirmPassword) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'New password and confirm password do not match.',
      );
    }

    if (oldPassword === newPassword) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'New password must be different from the old password.',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return null;
  }
}
