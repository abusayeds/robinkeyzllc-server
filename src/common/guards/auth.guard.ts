import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../errors/appError';
import { TAuthUser, TJwtPayload } from '../../interface/auth.interface';
import { TRole } from '../../utils/role';

export const ROLES_KEY = 'requiredRoles';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader: string | undefined = request.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'No token provided or invalid format.',
      );
    }

    const token = authHeader.split(' ')[1];

    let payload: TJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<TJwtPayload>(token);
    } catch {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Invalid token!');
    }

    if (!payload?.user?.id) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Invalid token!');
    }

    const user = (await this.prisma.user.findUnique({
      where: { id: payload.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        isDeleted: true,
        isEmailVerified: true,
      },
    })) as TAuthUser | null;

    if (!user || user.isDeleted) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'User not found or unauthorized.',
      );
    }

    const requiredRoles = this.reflector.getAllAndOverride<TRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
      throw new AppError(HttpStatus.FORBIDDEN, 'You are not authorized.');
    }

    request.user = user;
    return true;
  }
}
