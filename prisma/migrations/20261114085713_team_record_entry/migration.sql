-- CreateTable
CREATE TABLE "TeamRecordEntry" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "ties" INTEGER NOT NULL DEFAULT 0,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamRecordEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamRecordEntry_leagueId_seasonStartYear_idx" ON "TeamRecordEntry"("leagueId", "seasonStartYear");

-- CreateIndex
CREATE INDEX "TeamRecordEntry_updatedById_idx" ON "TeamRecordEntry"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRecordEntry_teamId_seasonStartYear_key" ON "TeamRecordEntry"("teamId", "seasonStartYear");

-- AddForeignKey
ALTER TABLE "TeamRecordEntry" ADD CONSTRAINT "TeamRecordEntry_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRecordEntry" ADD CONSTRAINT "TeamRecordEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRecordEntry" ADD CONSTRAINT "TeamRecordEntry_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
