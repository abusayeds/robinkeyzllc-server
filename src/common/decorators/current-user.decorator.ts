import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TAuthUser } from '../../interface/auth.interface';

export const CurrentUser = createParamDecorator(
  (data: keyof TAuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: TAuthUser | undefined = request.user;
    return data ? user?.[data] : user;
  },
);
