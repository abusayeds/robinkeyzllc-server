import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/appError';
import { TAuthUser, TJwtUser } from '../../interface/auth.interface';
import { generateOTP, sendForgotPasswordOtpEmail } from '../../utils/sendEmail';
import {
  changePasswordDto,
  forgotPasswordDto,
  resetPasswordDto,
  verifyOtpDto,
} from './dto/auth.dto';
import { loginUserDto } from './dto/login-user.dto';

const OTP_VALID_MINUTES = 10;

@Injectable()
export class authService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
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

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.isDeleted) {
      throw new AppError(HttpStatus.NOT_FOUND, 'This account does not exist.');
    }

    await this.issueOtp(email);

    const token = await this.signPurposeToken(email, 'forgot');
    return { token };
  }

  async verifyForgotPasswordOtp(payload: verifyOtpDto, rawToken: string) {
    const email = await this.readPurposeToken(rawToken, 'forgot');

    const otpRecord = await this.prisma.otp.findUnique({ where: { email } });
    if (!otpRecord) {
      throw new AppError(HttpStatus.NOT_FOUND, 'OTP not found!');
    }
    if (otpRecord.expiresAt < new Date()) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'OTP has expired');
    }
    if (otpRecord.otp !== payload.otp) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Wrong OTP');
    }

    await this.prisma.otp.delete({ where: { email } });

    const token = await this.signPurposeToken(email, 'verifyForgot');
    return { token };
  }

  async resendOtp(rawToken: string) {
    const email = await this.readPurposeToken(rawToken, 'forgot');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.isDeleted) {
      throw new AppError(HttpStatus.NOT_FOUND, 'This account does not exist.');
    }

    await this.issueOtp(email);

    const token = await this.signPurposeToken(email, 'forgot');
    return { token };
  }

  async resetPassword(payload: resetPasswordDto, rawToken: string) {
    const email = await this.readPurposeToken(rawToken, 'verifyForgot');

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

  private async issueOtp(email: string) {
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_VALID_MINUTES * 60 * 1000);

    await this.prisma.otp.upsert({
      where: { email },
      update: { otp, expiresAt },
      create: { email, otp, expiresAt },
    });

    await sendForgotPasswordOtpEmail(otp, email);
  }

  private async signPurposeToken(email: string, purpose: string) {
    return this.jwtService.signAsync(
      { email, purpose },
      { expiresIn: '10m' as JwtSignOptions['expiresIn'] },
    );
  }

  // Each step of the forget-password flow issues a token for the next step
  // only, so a "forgot" token cannot be used to reset a password.
  private async readPurposeToken(
    rawToken: string,
    expectedPurpose: string,
  ): Promise<string> {
    let decoded: { email?: string; purpose?: string };
    try {
      decoded = await this.jwtService.verifyAsync(rawToken);
    } catch {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Invalid or expired token');
    }

    if (!decoded?.email || decoded.purpose !== expectedPurpose) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Invalid token');
    }
    return decoded.email;
  }
}
