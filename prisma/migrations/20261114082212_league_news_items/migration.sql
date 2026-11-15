-- CreateEnum
CREATE TYPE "NewsItemType" AS ENUM ('trade', 'signing', 'extension', 'waiver', 'claim', 'offerSheet', 'draftPick', 'veto');

-- CreateEnum
CREATE TYPE "NewsItemTier" AS ENUM ('standard', 'blockbuster');

-- CreateEnum
CREATE TYPE "NewsItemSource" AS ENUM ('trade', 'freeAgencyOffer', 'waiver', 'draftSlot', 'draftPickEvent', 'contract');

-- CreateTable
CREATE TABLE "LeagueNewsItem" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "type" "NewsItemType" NOT NULL,
    "tier" "NewsItemTier" NOT NULL DEFAULT 'standard',
    "autoHeadline" TEXT NOT NULL,
    "customHeadline" TEXT,
    "payload" JSONB NOT NULL,
    "sourceType" "NewsItemSource" NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueNewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueNewsItem_leagueId_createdAt_idx" ON "LeagueNewsItem"("leagueId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueNewsItem_leagueId_sourceType_sourceId_key" ON "LeagueNewsItem"("leagueId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "LeagueNewsItem" ADD CONSTRAINT "LeagueNewsItem_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
