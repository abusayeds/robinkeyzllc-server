import { NameMatchMethod, NameMatchStatus } from '@prisma/client';

export { NameMatchMethod, NameMatchStatus };

/** What the import preview shows for a candidate the commissioner must judge. */
export type PlayerCandidate = {
  id: number;
  name: string;
  position: string | null;
  draftYear: number | null;
  nbaTeam: string | null;
  confidence: number;
};

export type NameMatch = {
  /** The name exactly as it was typed, so the preview can quote it back. */
  input: string;
  normalized: string;
  status: NameMatchStatus;
  method: NameMatchMethod | null;
  confidence: number | null;
  playerId: number | null;
  /** Empty when the match is certain; up to three when it is not. */
  candidates: PlayerCandidate[];
};
