-- CreateEnum
CREATE TYPE "SyncJob" AS ENUM ('teams', 'players');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" SERIAL NOT NULL,
    "job" "SyncJob" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'running',
    "finishedAt" TIMESTAMP(3),
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_job_startedAt_idx" ON "SyncRun"("job", "startedAt");
