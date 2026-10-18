import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LeagueRole, Role } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../errors/appError';
import type { TLeagueContext } from '../../interface/auth.interface';
import { TLeagueRole } from '../../utils/role';

export const LEAGUE_ROLES_KEY = 'requiredLeagueRoles';

const LEAGUE_MANAGER_ROLES: LeagueRole[] = [
  LeagueRole.commissioner,
  LeagueRole.coCommissioner,
];

@Injectable()
export class LeagueGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    // AuthGuard runs first and sets this. Reaching here without it means the
    // route was wired with LeagueGuard alone.
    if (!user) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'User not found or unauthorized.',
      );
    }

    const leagueId = this.resolveLeagueId(request);

    const league = await this.prisma.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { id: true },
    });
    if (!league) {
      throw new AppError(HttpStatus.NOT_FOUND, 'League not found.');
    }

    const membership = await this.prisma.leagueMember.findUnique({
      where: { userId_leagueId: { userId: user.id, leagueId } },
      select: { role: true },
    });

    const isSuperAdmin = user.role === Role.superAdmin;

    if (!membership && !isSuperAdmin) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'You are not a member of this league.',
      );
    }

    // Super Admin steps into any league with full Commissioner powers.
    const effectiveRole = isSuperAdmin
      ? LeagueRole.commissioner
      : (membership?.role as LeagueRole);

    const requiredRoles = this.reflector.getAllAndOverride<TLeagueRole[]>(
      LEAGUE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles?.length && !requiredRoles.includes(effectiveRole)) {
      throw new AppError(HttpStatus.FORBIDDEN, 'You are not authorized.');
    }

    const teamMembership = await this.prisma.teamMember.findUnique({
      where: { userId_leagueId: { userId: user.id, leagueId } },
      select: { role: true, team: { select: { id: true, name: true } } },
    });

    const leagueContext: TLeagueContext = {
      leagueId,
      role: effectiveRole,
      isSuperAdmin,
      canManageLeague: LEAGUE_MANAGER_ROLES.includes(effectiveRole),
      canManageAnyTeam: LEAGUE_MANAGER_ROLES.includes(effectiveRole),
      // Super Admin never makes team transactions, however far their reach goes.
      canTransact: !isSuperAdmin && Boolean(teamMembership),
      team: teamMembership
        ? {
            id: teamMembership.team.id,
            name: teamMembership.team.name,
            role: teamMembership.role,
          }
        : null,
    };

    request.league = leagueContext;
    return true;
  }

  private resolveLeagueId(request: Request): number {
    const params = request.params as Record<string, unknown> | undefined;
    const body = request.body as Record<string, unknown> | undefined;
    const query = request.query as Record<string, unknown> | undefined;

    const raw = params?.leagueId ?? body?.leagueId ?? query?.leagueId;
    const leagueId = Number(raw);

    if (raw === undefined || !Number.isInteger(leagueId) || leagueId < 1) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'A valid leagueId is required.',
      );
    }

    return leagueId;
  }
}
