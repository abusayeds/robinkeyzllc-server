-- Appendix B item 7 — the owner's ranking input on an offer sheet, recorded
-- as entered. Nullable, so existing offers keep no rank and nothing is
-- back-filled.
ALTER TABLE "FreeAgencyOffer" ADD COLUMN "rank" INTEGER;
