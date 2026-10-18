import { LeagueRole, Role, TeamRole } from '@prisma/client';

// Platform-wide role. Super Admin is the only one; every league role lives on
// the LeagueMember row instead, because a user holds a different role in each
// league they belong to.
export const role = {
  user: Role.user,
  superAdmin: Role.superAdmin,
} as const;

export const leagueRole = {
  commissioner: LeagueRole.commissioner,
  coCommissioner: LeagueRole.coCommissioner,
  member: LeagueRole.member,
} as const;

export const teamRole = {
  owner: TeamRole.owner,
  coOwner: TeamRole.coOwner,
} as const;

export type TRole = Role;
export type TLeagueRole = LeagueRole;
export type TTeamRole = TeamRole;
