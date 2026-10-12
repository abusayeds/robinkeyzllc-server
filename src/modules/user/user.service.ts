import { HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma, Role, type User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/appError';
import { OTP_PURPOSE, OtpService } from '../../common/otp/otp.service';
import { QueryBuilder } from '../../builder/queryBuilder';
import {
  sendInBackground,
  sendRegistrationOtpEmail,
} from '../../utils/sendEmail';
import { createUserDto } from './dto/create-user.dto';
import { verifyEmailDto } from './dto/verify-email.dto';

const safeUserSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  isDeleted: true,
  isEmailVerified: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class usersService {
  constructor(
    private prisma: PrismaService,
    private readonly otpService: OtpService,
  ) {}

  async register(createUserDto: createUserDto) {
    const { email, name, password, phone } = createUserDto;
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser && (existingUser.isEmailVerified || existingUser.isDeleted)) {
    throw new AppError(HttpStatus.CONFLICT,'User with this email already exists');
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    if (existingUser) {
      await this.prisma.user.update({
        where: { email },
        data: { name, phone, password: hashedPassword },
      });
    } else {
      await this.prisma.user.create({
        data: { email, name, phone, password: hashedPassword },
      });
    }

    const otp = await this.otpService.issue(email);
    const token = await this.otpService.signToken(
      email,
      OTP_PURPOSE.verifyEmail,
    );

    sendInBackground(
      () => sendRegistrationOtpEmail(otp, email),
      `registration OTP to ${email}`,
    );

    return { token };
  }

  async verifyEmailOtpDB(payload: verifyEmailDto, rawToken: string) {
    const email = await this.otpService.readToken(
      rawToken,
      OTP_PURPOSE.verifyEmail,
    );

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.isDeleted) {
      throw new AppError(HttpStatus.NOT_FOUND, 'User not found.');
    }
    if (user.isEmailVerified) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Email is already verified.');
    }

    await this.otpService.verify(email, payload.otp);

    return this.prisma.user.update({
      where: { email },
      data: { isEmailVerified: true },
      select: safeUserSelect,
    });
  }

  async resendEmailOtpDB(rawToken: string) {
    const email = await this.otpService.readToken(
      rawToken,
      OTP_PURPOSE.verifyEmail,
    );

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.isDeleted) {
      throw new AppError(HttpStatus.NOT_FOUND, 'User not found.');
    }
    if (user.isEmailVerified) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'Email is already verified.');
    }

    const otp = await this.otpService.issue(email);
    const token = await this.otpService.signToken(
      email,
      OTP_PURPOSE.verifyEmail,
    );

    sendInBackground(
      () => sendRegistrationOtpEmail(otp, email),
      `registration OTP to ${email}`,
    );

    return { token };
  }

  async getAllUsersDB(query: Record<string, unknown>) {
    const queryBuilder = new QueryBuilder<User>(query)
      .search(['name', 'email', 'phone'])
      .filter()
      .sort()
      .paginate();

    const args = queryBuilder.build<Prisma.UserFindManyArgs>();

    const [data, totalItem] = await Promise.all([
      this.prisma.user.findMany({ ...args, select: safeUserSelect }),
      this.prisma.user.count({ where: queryBuilder.getWhere() }),
    ]);

    return { data, pagination: queryBuilder.calculatePagination(totalItem) };
  }

  async getSingleUserDB(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: safeUserSelect,
    });
    if (!user || user.isDeleted) {
      throw new AppError(HttpStatus.NOT_FOUND, 'User not found');
    }
    return user;
  }

  async myProfileDB(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: safeUserSelect,
    });
    if (!user || user.isDeleted) {
      throw new AppError(HttpStatus.NOT_FOUND, 'User not found.');
    }
    return user;
  }

  async deleteUserDB(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new AppError(HttpStatus.NOT_FOUND, 'User not found.');
    }
    if (user.isDeleted) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'User is already deleted.');
    }
    if (user.role !== Role.user) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        `Cannot delete a ${user.role} account.`,
      );
    }

    await this.prisma.user.update({
      where: { id },
      data: { isDeleted: true },
    });

    return null;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }
}
