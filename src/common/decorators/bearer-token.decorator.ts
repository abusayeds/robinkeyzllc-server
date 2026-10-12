import {
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import { AppError } from '../errors/appError';

// Returns the raw bearer token. Used by the forget-password flow, whose
// tokens are purpose-scoped and verified by the service, not by AuthGuard.
export const BearerToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'No token provided or invalid format.',
      );
    }
    return authHeader.split(' ')[1];
  },
);
