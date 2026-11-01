/*
  Warnings:

  - A unique constraint covering the columns `[leagueId,abbr]` on the table `Team` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `abbr` to the `Team` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "LeagueInviteStatus" AS ENUM ('pending', 'accepted', 'declined', 'cancelled');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "abbr" TEXT NOT NULL,
ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#2563EB';

-- CreateTable
CREATE TABLE "LeagueInvite" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "invitedById" INTEGER,
    "status" "LeagueInviteStatus" NOT NULL DEFAULT 'pending',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueInvite_userId_status_idx" ON "LeagueInvite"("userId", "status");

-- CreateIndex
CREATE INDEX "LeagueInvite_leagueId_status_idx" ON "LeagueInvite"("leagueId", "status");

-- CreateIndex
CREATE INDEX "LeagueInvite_invitedById_idx" ON "LeagueInvite"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueInvite_leagueId_userId_key" ON "LeagueInvite"("leagueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_leagueId_abbr_key" ON "Team"("leagueId", "abbr");

-- AddForeignKey
ALTER TABLE "LeagueInvite" ADD CONSTRAINT "LeagueInvite_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueInvite" ADD CONSTRAINT "LeagueInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueInvite" ADD CONSTRAINT "LeagueInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
