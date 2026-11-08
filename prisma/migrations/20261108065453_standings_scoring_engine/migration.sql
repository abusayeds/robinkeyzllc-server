-- CreateEnum
CREATE TYPE "Conference" AS ENUM ('east', 'west');

-- CreateEnum
CREATE TYPE "WeekPhase" AS ENUM ('regular', 'playoffs');

-- CreateEnum
CREATE TYPE "MatchupStatus" AS ENUM ('upcoming', 'live', 'final');

-- CreateEnum
CREATE TYPE "PlayoffRound" AS ENUM ('semifinal', 'conferenceFinal', 'championship');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SyncJob" ADD VALUE 'games';
ALTER TYPE "SyncJob" ADD VALUE 'stats';

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "conference" "Conference" NOT NULL DEFAULT 'east',
ADD COLUMN     "division" TEXT;

-- CreateTable
CREATE TABLE "ScheduleWeek" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "phase" "WeekPhase" NOT NULL DEFAULT 'regular',
    "isSettled" BOOLEAN NOT NULL DEFAULT false,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Matchup" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "weekId" INTEGER NOT NULL,
    "homeTeamId" INTEGER,
    "awayTeamId" INTEGER,
    "homeSeed" INTEGER,
    "awaySeed" INTEGER,
    "playoffRound" "PlayoffRound",
    "playoffConference" "Conference",
    "status" "MatchupStatus" NOT NULL DEFAULT 'upcoming',
    "homeCategoryWins" INTEGER NOT NULL DEFAULT 0,
    "awayCategoryWins" INTEGER NOT NULL DEFAULT 0,
    "tiedCategories" INTEGER NOT NULL DEFAULT 0,
    "winnerTeamId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Matchup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchupTeamStat" (
    "id" SERIAL NOT NULL,
    "matchupId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "fgm" INTEGER NOT NULL DEFAULT 0,
    "fga" INTEGER NOT NULL DEFAULT 0,
    "ftm" INTEGER NOT NULL DEFAULT 0,
    "fta" INTEGER NOT NULL DEFAULT 0,
    "fg3m" INTEGER NOT NULL DEFAULT 0,
    "pts" INTEGER NOT NULL DEFAULT 0,
    "reb" INTEGER NOT NULL DEFAULT 0,
    "ast" INTEGER NOT NULL DEFAULT 0,
    "stl" INTEGER NOT NULL DEFAULT 0,
    "blk" INTEGER NOT NULL DEFAULT 0,
    "turnover" INTEGER NOT NULL DEFAULT 0,
    "categoryWins" INTEGER NOT NULL DEFAULT 0,
    "weekPoints" INTEGER NOT NULL DEFAULT 0,
    "playerCount" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchupTeamStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NbaGame" (
    "id" SERIAL NOT NULL,
    "bdlGameId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "season" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "period" INTEGER NOT NULL DEFAULT 0,
    "postseason" BOOLEAN NOT NULL DEFAULT false,
    "homeTeamScore" INTEGER NOT NULL DEFAULT 0,
    "visitorTeamScore" INTEGER NOT NULL DEFAULT 0,
    "homeNbaTeamId" INTEGER NOT NULL,
    "visitorNbaTeamId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "NbaGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerGameStat" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "gameId" INTEGER NOT NULL,
    "gameDate" DATE NOT NULL,
    "season" INTEGER NOT NULL,
    "minutes" TEXT,
    "fgm" INTEGER NOT NULL DEFAULT 0,
    "fga" INTEGER NOT NULL DEFAULT 0,
    "ftm" INTEGER NOT NULL DEFAULT 0,
    "fta" INTEGER NOT NULL DEFAULT 0,
    "fg3m" INTEGER NOT NULL DEFAULT 0,
    "fg3a" INTEGER NOT NULL DEFAULT 0,
    "pts" INTEGER NOT NULL DEFAULT 0,
    "reb" INTEGER NOT NULL DEFAULT 0,
    "oreb" INTEGER NOT NULL DEFAULT 0,
    "dreb" INTEGER NOT NULL DEFAULT 0,
    "ast" INTEGER NOT NULL DEFAULT 0,
    "stl" INTEGER NOT NULL DEFAULT 0,
    "blk" INTEGER NOT NULL DEFAULT 0,
    "turnover" INTEGER NOT NULL DEFAULT 0,
    "pf" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerGameStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleWeek_leagueId_seasonStartYear_startDate_idx" ON "ScheduleWeek"("leagueId", "seasonStartYear", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleWeek_leagueId_seasonStartYear_weekNumber_key" ON "ScheduleWeek"("leagueId", "seasonStartYear", "weekNumber");

-- CreateIndex
CREATE INDEX "Matchup_leagueId_weekId_idx" ON "Matchup"("leagueId", "weekId");

-- CreateIndex
CREATE INDEX "Matchup_homeTeamId_idx" ON "Matchup"("homeTeamId");

-- CreateIndex
CREATE INDEX "Matchup_awayTeamId_idx" ON "Matchup"("awayTeamId");

-- CreateIndex
CREATE INDEX "MatchupTeamStat_teamId_idx" ON "MatchupTeamStat"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchupTeamStat_matchupId_teamId_key" ON "MatchupTeamStat"("matchupId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "NbaGame_bdlGameId_key" ON "NbaGame"("bdlGameId");

-- CreateIndex
CREATE INDEX "NbaGame_date_idx" ON "NbaGame"("date");

-- CreateIndex
CREATE INDEX "NbaGame_season_date_idx" ON "NbaGame"("season", "date");

-- CreateIndex
CREATE INDEX "PlayerGameStat_playerId_gameDate_idx" ON "PlayerGameStat"("playerId", "gameDate");

-- CreateIndex
CREATE INDEX "PlayerGameStat_gameDate_idx" ON "PlayerGameStat"("gameDate");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerGameStat_playerId_gameId_key" ON "PlayerGameStat"("playerId", "gameId");

-- AddForeignKey
ALTER TABLE "ScheduleWeek" ADD CONSTRAINT "ScheduleWeek_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchup" ADD CONSTRAINT "Matchup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchup" ADD CONSTRAINT "Matchup_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "ScheduleWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchup" ADD CONSTRAINT "Matchup_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchup" ADD CONSTRAINT "Matchup_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchup" ADD CONSTRAINT "Matchup_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchupTeamStat" ADD CONSTRAINT "MatchupTeamStat_matchupId_fkey" FOREIGN KEY ("matchupId") REFERENCES "Matchup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchupTeamStat" ADD CONSTRAINT "MatchupTeamStat_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaGame" ADD CONSTRAINT "NbaGame_homeNbaTeamId_fkey" FOREIGN KEY ("homeNbaTeamId") REFERENCES "NbaTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NbaGame" ADD CONSTRAINT "NbaGame_visitorNbaTeamId_fkey" FOREIGN KEY ("visitorNbaTeamId") REFERENCES "NbaTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerGameStat" ADD CONSTRAINT "PlayerGameStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerGameStat" ADD CONSTRAINT "PlayerGameStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "NbaGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
