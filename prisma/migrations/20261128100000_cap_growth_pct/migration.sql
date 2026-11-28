-- How much the cap is assumed to grow each league year nobody has entered
-- figures for, as a whole percent. NOT NULL with a default, so every existing
-- league gets 7 without a back-fill statement.
ALTER TABLE "LeagueSettings" ADD COLUMN "capGrowthPct" DOUBLE PRECISION NOT NULL DEFAULT 7;
