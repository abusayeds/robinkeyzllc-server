import { LeagueContentType } from '@prisma/client';

// source tells the UI where the text came from: the league's own row, the
// platform default it has not overridden yet, or nothing written anywhere.
export type TLeagueContentEntry = {
  type: LeagueContentType;
  description: string;
  source: 'league' | 'platform' | null;
  updatedAt: Date | null;
  updatedBy: { id: number; name: string } | null;
};
