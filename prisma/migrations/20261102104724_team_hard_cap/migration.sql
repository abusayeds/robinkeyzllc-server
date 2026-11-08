-- CreateEnum
CREATE TYPE "HardCapApron" AS ENUM ('firstApron', 'secondApron');

-- CreateEnum
CREATE TYPE "HardCapTrigger" AS ENUM ('tookBackMoreSalary', 'signAndTradeAcquisition', 'tradeExceptionBelowFirstApron', 'nonTaxpayerMleAboveTaxpayerAmount', 'nonTaxpayerMleTradeOrClaim', 'biAnnualException', 'waivedPlayerAboveMle', 'aggregatedSalaries', 'tradeExceptionBetweenAprons', 'taxpayerMle', 'signAndTradeSendOut');

-- CreateTable
CREATE TABLE "TeamHardCap" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "threshold" "HardCapApron" NOT NULL,
    "trigger" "HardCapTrigger" NOT NULL,
    "amountAtTrigger" INTEGER NOT NULL,
    "note" TEXT,
    "sourceTradeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamHardCap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamHardCap_leagueId_seasonStartYear_idx" ON "TeamHardCap"("leagueId", "seasonStartYear");

-- CreateIndex
CREATE UNIQUE INDEX "TeamHardCap_teamId_seasonStartYear_key" ON "TeamHardCap"("teamId", "seasonStartYear");

-- AddForeignKey
ALTER TABLE "TeamHardCap" ADD CONSTRAINT "TeamHardCap_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamHardCap" ADD CONSTRAINT "TeamHardCap_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamHardCap" ADD CONSTRAINT "TeamHardCap_sourceTradeId_fkey" FOREIGN KEY ("sourceTradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
