import { HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma, Role, type User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/appError';
import { QueryBuilder } from '../../builder/queryBuilder';
import { createUserDto } from './dto/create-user.dto';

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
  constructor(private prisma: PrismaService) {}

  async register(createUserDto: createUserDto) {
    const { email, name, password, phone } = createUserDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'User with this email already exists',
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        phone,
      },
      select: safeUserSelect,
    });

    return user;
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
