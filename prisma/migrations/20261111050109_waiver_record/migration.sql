-- CreateTable
CREATE TABLE "Waiver" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "deadMoneyTotal" INTEGER NOT NULL DEFAULT 0,
    "isStretched" BOOLEAN NOT NULL DEFAULT false,
    "seasonsOwed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Waiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Waiver_leagueId_createdAt_idx" ON "Waiver"("leagueId", "createdAt");

-- CreateIndex
CREATE INDEX "Waiver_leagueId_teamId_idx" ON "Waiver"("leagueId", "teamId");

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
