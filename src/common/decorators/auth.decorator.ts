import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard, ROLES_KEY } from '../guards/auth.guard';
import { TRole } from '../../utils/role';

// @Auth() = logged in only. @Auth(role.admin) = admin only.
export const Auth = (...requiredRoles: TRole[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, requiredRoles), UseGuards(AuthGuard));
