/*
  Warnings:

  - Added the required column `season` to the `League` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ScoringType" AS ENUM ('headToHead9Cat');

-- CreateEnum
CREATE TYPE "DraftType" AS ENUM ('snake');

-- CreateEnum
CREATE TYPE "LeagueVisibility" AS ENUM ('private', 'public');

-- AlterTable
ALTER TABLE "League" ADD COLUMN     "draftType" "DraftType" NOT NULL DEFAULT 'snake',
ADD COLUMN     "scoringType" "ScoringType" NOT NULL DEFAULT 'headToHead9Cat',
ADD COLUMN     "season" TEXT NOT NULL,
ADD COLUMN     "teamCount" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "visibility" "LeagueVisibility" NOT NULL DEFAULT 'private';

-- CreateIndex
CREATE INDEX "League_visibility_isDeleted_idx" ON "League"("visibility", "isDeleted");
