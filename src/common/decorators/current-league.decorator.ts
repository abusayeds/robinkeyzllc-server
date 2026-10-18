import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TLeagueContext } from '../../interface/auth.interface';

export const CurrentLeague = createParamDecorator(
  (data: keyof TLeagueContext | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    const league = request.league;

    return data ? league?.[data] : league;
  },
);
