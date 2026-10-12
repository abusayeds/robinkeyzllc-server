import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../errors/appError';
import { generateOTP } from '../../utils/sendEmail';

export const OTP_PURPOSE = {
  verifyEmail: 'verifyEmail',
  forgot: 'forgot',
  verifyForgot: 'verifyForgot',
} as const;

export type TOtpPurpose = (typeof OTP_PURPOSE)[keyof typeof OTP_PURPOSE];

const OTP_VALID_MINUTES = 10;
const TOKEN_VALID = '10m';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async issue(email: string): Promise<string> {
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_VALID_MINUTES * 60 * 1000);

    await this.prisma.otp.upsert({
      where: { email },
      update: { otp, expiresAt },
      create: { email, otp, expiresAt },
    });

    // Printed outside production so the flow can be tested without waiting
    // for the email to arrive.
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`OTP for ${email}: ${otp}`);
    }

    return otp;
  }

  async verify(email: string, otp: string): Promise<void> {
    const record = await this.prisma.otp.findUnique({ where: { email } });

    if (!record) {
      throw new AppError(HttpStatus.NOT_FOUND, 'OTP not found!');
    }
    if (record.expiresAt < new Date()) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'OTP has expired');
    }
    if (record.otp !== otp) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Wrong OTP');
    }

    await this.prisma.otp.delete({ where: { email } });
  }

  signToken(email: string, purpose: TOtpPurpose): Promise<string> {
    return this.jwtService.signAsync(
      { email, purpose },
      { expiresIn: TOKEN_VALID as JwtSignOptions['expiresIn'] },
    );
  }
  async readToken(rawToken: string, expected: TOtpPurpose): Promise<string> {
    let decoded: { email?: string; purpose?: string };
    try {
      decoded = await this.jwtService.verifyAsync(rawToken);
    } catch {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Invalid or expired token');
    }

    if (!decoded?.email || decoded.purpose !== expected) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Invalid token');
    }
    return decoded.email;
  }
}
