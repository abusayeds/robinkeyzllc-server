-- CreateTable
CREATE TABLE "PlayerSeasonAverage" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "gamesPlayed" INTEGER NOT NULL,
    "minutes" TEXT,
    "pts" DOUBLE PRECISION NOT NULL,
    "reb" DOUBLE PRECISION NOT NULL,
    "ast" DOUBLE PRECISION NOT NULL,
    "stl" DOUBLE PRECISION NOT NULL,
    "blk" DOUBLE PRECISION NOT NULL,
    "to" DOUBLE PRECISION NOT NULL,
    "fg3m" DOUBLE PRECISION NOT NULL,
    "fgPct" DOUBLE PRECISION NOT NULL,
    "ftPct" DOUBLE PRECISION NOT NULL,
    "fg3Pct" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerSeasonAverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerSeasonAverage_season_idx" ON "PlayerSeasonAverage"("season");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSeasonAverage_playerId_season_key" ON "PlayerSeasonAverage"("playerId", "season");

-- AddForeignKey
ALTER TABLE "PlayerSeasonAverage" ADD CONSTRAINT "PlayerSeasonAverage_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
