-- CreateEnum
CREATE TYPE "CalendarPhase" AS ENUM ('leagueYear', 'freeAgency', 'contracts', 'nba', 'draft', 'roster', 'season', 'trades', 'playoffs', 'offseason');

-- AlterTable
ALTER TABLE "LeagueSettings" ADD COLUMN     "maxRosterSize" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "maxTwoWay" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "minRosterSize" INTEGER NOT NULL DEFAULT 13,
ADD COLUMN     "pregameLockMinutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "slotBench" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "slotCenter" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "slotFlex" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "slotForward" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "slotGuard" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "slotIr" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "LeagueCalendarEvent" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "season" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "phase" "CalendarPhase" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isApproximate" BOOLEAN NOT NULL DEFAULT false,
    "displayLabel" TEXT,
    "time" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueCalendarEvent_leagueId_season_startDate_idx" ON "LeagueCalendarEvent"("leagueId", "season", "startDate");

-- AddForeignKey
ALTER TABLE "LeagueCalendarEvent" ADD CONSTRAINT "LeagueCalendarEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
