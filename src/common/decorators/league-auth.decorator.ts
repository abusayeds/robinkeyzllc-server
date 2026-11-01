import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { LEAGUE_ROLES_KEY, LeagueGuard } from '../guards/league.guard';
import { TLeagueRole } from '../../utils/role';
  
export const LeagueAuth = (...requiredRoles: TLeagueRole[]) =>
  applyDecorators(
    SetMetadata(LEAGUE_ROLES_KEY, requiredRoles),
    UseGuards(AuthGuard, LeagueGuard),
  );
