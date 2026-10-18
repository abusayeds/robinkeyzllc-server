import { LeagueRole, Role, TeamRole } from '@prisma/client';

export type TJwtUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
};

export type TJwtPayload = {
  user: TJwtUser;
  iat?: number;
  exp?: number;
};

export type TAuthUser = {
  id: number;
  email: string;
  name: string;
  phone: string;
  role: Role;
  isDeleted: boolean;
  isEmailVerified: boolean;
};

export type TAuthTeam = {
  id: number;
  name: string;
  role: TeamRole;
};

/**
 * The caller's standing inside one league, resolved per request by LeagueGuard.
 * The matrix has five permission values (Yes / No / View / Own team / Any
 * team), so a handler needs the scope flags below, not a single boolean.
 */
export type TLeagueContext = {
  leagueId: number;
  role: LeagueRole;
  isSuperAdmin: boolean;
  canManageLeague: boolean;
  canManageAnyTeam: boolean;
  canTransact: boolean;
  team: TAuthTeam | null;
};
