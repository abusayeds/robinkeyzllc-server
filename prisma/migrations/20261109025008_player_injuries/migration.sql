-- AlterEnum
ALTER TYPE "SyncJob" ADD VALUE 'injuries';

-- CreateTable
CREATE TABLE "PlayerInjury" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "returnDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerInjury_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerInjury_playerId_key" ON "PlayerInjury"("playerId");

-- CreateIndex
CREATE INDEX "PlayerInjury_status_idx" ON "PlayerInjury"("status");

-- AddForeignKey
ALTER TABLE "PlayerInjury" ADD CONSTRAINT "PlayerInjury_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
