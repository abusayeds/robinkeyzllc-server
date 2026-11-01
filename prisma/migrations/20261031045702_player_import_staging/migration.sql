-- CreateEnum
CREATE TYPE "NameMatchStatus" AS ENUM ('matched', 'needsReview', 'notFound');

-- CreateEnum
CREATE TYPE "NameMatchMethod" AS ENUM ('exact', 'alias', 'fuzzy');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('preview', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "ImportRowType" AS ENUM ('contract', 'rights', 'deadCap', 'unknown');

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "uploadedById" INTEGER,
    "filename" TEXT NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'preview',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "rawTeam" TEXT NOT NULL,
    "rawPlayer" TEXT NOT NULL,
    "rawBirdYears" TEXT,
    "rawContractType" TEXT,
    "rawSignedVia" TEXT,
    "rawSignedSeason" TEXT,
    "rawSeasons" JSONB NOT NULL,
    "rowType" "ImportRowType" NOT NULL DEFAULT 'unknown',
    "matchStatus" "NameMatchStatus" NOT NULL DEFAULT 'notFound',
    "matchMethod" "NameMatchMethod",
    "matchConfidence" DOUBLE PRECISION,
    "playerId" INTEGER,
    "teamId" INTEGER,
    "issues" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_leagueId_status_idx" ON "ImportBatch"("leagueId", "status");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_matchStatus_idx" ON "ImportRow"("batchId", "matchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_lineNumber_key" ON "ImportRow"("batchId", "lineNumber");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
