import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard, ROLES_KEY } from '../guards/auth.guard';
import { TRole } from '../../utils/role';

// Platform-level only. @Auth() = logged in. @Auth(role.superAdmin) = Super
// Admin. League and team permissions go through @LeagueAuth instead.
export const Auth = (...requiredRoles: TRole[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, requiredRoles), UseGuards(AuthGuard));
