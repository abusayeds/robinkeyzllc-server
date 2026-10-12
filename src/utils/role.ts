import { Role } from '@prisma/client';

export const role = {
  admin: Role.admin,
  user: Role.user,
} as const;

export type TRole = Role;
