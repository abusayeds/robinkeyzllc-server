import { Conference, TeamIntelStatus, TeamRole } from '@prisma/client';

export type TTeamHolder = {
  userId: number;
  name: string;
  email: string;
  image: string | null;
  role: TeamRole;
};

export type TTeam = {
  id: number;
  leagueId: number;
  name: string;
  abbr: string;
  color: string;
  logo: string | null;
  /** Which half of the league it plays in. The standings split on it. */
  conference: Conference;
  /** Free text, because a league names its own. Null falls back to the conference. */
  division: string | null;
  owner: TTeamHolder | null;
  coOwner: TTeamHolder | null;
  /** League Intel, set by this team's own owner. Null means they have not said. */
  intelStatus: TeamIntelStatus | null;
  createdAt: Date;
};

export type TTeamList = {
  /** How many teams this league is allowed to hold. */
  teamCount: number;
  /** Roster size cap, so a team row can show "x / max" once players exist. */
  maxRosterSize: number;
  teams: TTeam[];
};
