-- The feed's season-averages endpoint reports a player's age for the season.
-- It is the only place balldontlie gives one on any tier, so it is kept as
-- the fallback for a card whose player has no imported birthdate.
ALTER TABLE "PlayerSeasonAverage" ADD COLUMN "age" INTEGER;
