-- Trigram search, used to find the closest player when an imported name does
-- not match exactly. Prisma does not track extensions, so this is written by
-- hand rather than generated.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Without this index every fuzzy lookup scans the whole player table. The GIN
-- index is what makes the `%` operator and similarity() usable on a few
-- thousand rows per import.
CREATE INDEX IF NOT EXISTS "Player_nameNormalized_trgm_idx"
  ON "Player" USING GIN ("nameNormalized" gin_trgm_ops);
