import {
  DraftType,
  LeagueRole,
  LeagueVisibility,
  ScoringType,
} from '@prisma/client';

export type TUiLeagueRole = 'Team Owner' | 'Commissioner';

// CAP_MULTIPLIERS used to live here. It is gone: the AVORA CBA (Article 2)
// says the tax line and both aprons are **entered** by the Super Admin each
// league year, not worked out from the cap. Its figures were also not the
// client's — 127% against their 126.71% is about $480,000 on a $165M cap,
// enough to put a team in the wrong tier. Everything now reads CapService.

export type TCapThresholds = {
  salaryFloor: number;
  luxuryTax: number;
  firstApron: number;
  secondApron: number;
  maxPlayerSalary: number;
};

export type TLeagueSummary = {
  id: number;
  name: string;
  logo: string | null;
  teamCount: number;
  season: string;
  scoringType: ScoringType;
  draftType: DraftType;
  visibility: LeagueVisibility;
  leagueRole: LeagueRole;
  roles: TUiLeagueRole[];
  team: {
    id: number;
    name: string;
    logo: string | null;
    role: string;
  } | null;
  createdAt: Date;
};

export type TLeagueMember = {
  userId: number;
  name: string;
  email: string;
  image: string | null;
  role: LeagueRole;
  hasTeam: boolean;
  /** The team they manage in this league, or null when they hold none. */
  team: { id: number; name: string; abbr: string; logo: string | null } | null;
  joinedAt: Date;
};
