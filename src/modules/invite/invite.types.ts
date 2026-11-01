import { LeagueInviteStatus } from '@prisma/client';

/** What the commissioner sees on the league's invite list. */
export type TLeagueInvite = {
  id: number;
  status: LeagueInviteStatus;
  user: {
    userId: number;
    name: string;
    email: string;
    image: string | null;
  };
  invitedBy: string | null;
  createdAt: Date;
  respondedAt: Date | null;
};

/** What the invited user sees on Avora Home. */
export type TMyInvite = {
  id: number;
  leagueId: number;
  leagueName: string;
  leagueLogo: string | null;
  season: string;
  invitedBy: string | null;
  createdAt: Date;
};
