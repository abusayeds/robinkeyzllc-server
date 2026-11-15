-- AlterTable
ALTER TABLE "CapRuleSet" ADD COLUMN     "aggregationWaitMonths" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "taxpayerMatchAddOn" INTEGER NOT NULL DEFAULT 100000,
ADD COLUMN     "taxpayerMatchPct" DOUBLE PRECISION NOT NULL DEFAULT 110;

-- AlterTable
ALTER TABLE "LeaguePlayer" ADD COLUMN     "tradeAcquiredAt" TIMESTAMP(3);
