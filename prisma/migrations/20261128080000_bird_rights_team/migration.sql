-- Rule 9.1 — the team that holds a player's bird years, which is not always
-- the team that rosters him. Nullable, so no back-fill is needed and no
-- existing row is touched.
ALTER TABLE "LeaguePlayer" ADD COLUMN "birdRightsTeamId" INTEGER;

CREATE INDEX "LeaguePlayer_birdRightsTeamId_idx" ON "LeaguePlayer"("birdRightsTeamId");

ALTER TABLE "LeaguePlayer"
  ADD CONSTRAINT "LeaguePlayer_birdRightsTeamId_fkey"
  FOREIGN KEY ("birdRightsTeamId") REFERENCES "Team"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
