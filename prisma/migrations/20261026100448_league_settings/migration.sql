-- CreateEnum
CREATE TYPE "LeagueSetupMode" AS ENUM ('startup', 'import');

-- CreateEnum
CREATE TYPE "FreeAgencyStyle" AS ENUM ('dynamic', 'auction');

-- CreateEnum
CREATE TYPE "HardCapThreshold" AS ENUM ('none', 'luxuryTax', 'firstApron', 'secondApron');

-- CreateTable
CREATE TABLE "LeagueSettings" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "setupMode" "LeagueSetupMode" NOT NULL DEFAULT 'startup',
    "setupLocked" BOOLEAN NOT NULL DEFAULT false,
    "freeAgencyStyle" "FreeAgencyStyle" NOT NULL DEFAULT 'dynamic',
    "salaryMatching" BOOLEAN NOT NULL DEFAULT true,
    "apronRules" BOOLEAN NOT NULL DEFAULT true,
    "allowTradeExceptions" BOOLEAN NOT NULL DEFAULT true,
    "allowTradingTradeExceptions" BOOLEAN NOT NULL DEFAULT true,
    "allowDraftPickTrading" BOOLEAN NOT NULL DEFAULT true,
    "commissionerTradeApproval" BOOLEAN NOT NULL DEFAULT false,
    "salaryCap" INTEGER NOT NULL DEFAULT 141000000,
    "minPlayerSalary" INTEGER NOT NULL DEFAULT 1119563,
    "hardCapEnabled" BOOLEAN NOT NULL DEFAULT false,
    "hardCapThreshold" "HardCapThreshold" NOT NULL DEFAULT 'luxuryTax',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeagueSettings_leagueId_key" ON "LeagueSettings"("leagueId");

-- AddForeignKey
ALTER TABLE "LeagueSettings" ADD CONSTRAINT "LeagueSettings_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
