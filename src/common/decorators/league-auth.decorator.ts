import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { LEAGUE_ROLES_KEY, LeagueGuard } from '../guards/league.guard';
import { TLeagueRole } from '../../utils/role';

/**
 * Logged in and a member of the league named by leagueId (route param, body or
 * query). @LeagueAuth() = any member. @LeagueAuth(leagueRole.commissioner) =
 * that role only. A Super Admin always passes, as a Commissioner.
 */
export const LeagueAuth = (...requiredRoles: TLeagueRole[]) =>
  applyDecorators(
    SetMetadata(LEAGUE_ROLES_KEY, requiredRoles),
    UseGuards(AuthGuard, LeagueGuard),
  );
