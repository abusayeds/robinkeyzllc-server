-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "weight" TEXT;

-- AlterTable
ALTER TABLE "PlayerGameStat" ADD COLUMN     "nbaTeamId" INTEGER;

-- CreateIndex
CREATE INDEX "PlayerGameStat_playerId_season_idx" ON "PlayerGameStat"("playerId", "season");

-- AddForeignKey
ALTER TABLE "PlayerGameStat" ADD CONSTRAINT "PlayerGameStat_nbaTeamId_fkey" FOREIGN KEY ("nbaTeamId") REFERENCES "NbaTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
