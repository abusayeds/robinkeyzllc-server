import { Role } from '@prisma/client';

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
