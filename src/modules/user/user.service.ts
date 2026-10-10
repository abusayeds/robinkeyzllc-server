import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { sendResponse } from 'src/utils/sendResponse';
import { createUserDto } from './dto/create-user.dto';

@Injectable()
export class usersService {
  constructor(private prisma: PrismaService) {}
  async register(createUserDto: createUserDto) {
    const { email, name, password, phone } = createUserDto;
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        phone,
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        createdAt: true,
      },
    });
    return {
      message: 'User registered successfully',
      user,
    };
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }
}
