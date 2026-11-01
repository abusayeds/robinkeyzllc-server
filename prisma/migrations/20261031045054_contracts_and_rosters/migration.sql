-- CreateEnum
CREATE TYPE "LeaguePlayerStatus" AS ENUM ('rostered', 'rightsHeld', 'freeAgent', 'waived');

-- CreateEnum
CREATE TYPE "RosterSlotType" AS ENUM ('standard', 'twoWay', 'injuredReserve');

-- CreateEnum
CREATE TYPE "ContractSource" AS ENUM ('import', 'startupSeed', 'signing', 'trade', 'commissionerEdit');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('standard', 'rookieScale', 'veteranMinimum', 'supermax', 'twoWay', 'nonGuaranteed', 'partiallyGuaranteed');

-- CreateEnum
CREATE TYPE "SignedVia" AS ENUM ('capSpace', 'nonTaxpayerMle', 'taxpayerMle', 'roomMle', 'biAnnualException', 'disabledPlayerException');

-- CreateEnum
CREATE TYPE "ContractOptionType" AS ENUM ('player', 'team', 'earlyTermination');

-- CreateEnum
CREATE TYPE "GuaranteeType" AS ENUM ('full', 'partial', 'none');

-- CreateTable
CREATE TABLE "LeaguePlayer" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "teamId" INTEGER,
    "status" "LeaguePlayerStatus" NOT NULL DEFAULT 'rostered',
    "birdYears" INTEGER NOT NULL DEFAULT 0,
    "slotType" "RosterSlotType" NOT NULL DEFAULT 'standard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaguePlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "leaguePlayerId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "contractType" "ContractType" NOT NULL DEFAULT 'standard',
    "signedVia" "SignedVia" NOT NULL DEFAULT 'capSpace',
    "source" "ContractSource" NOT NULL DEFAULT 'import',
    "signedSeasonStartYear" INTEGER,
    "startSeasonStartYear" INTEGER NOT NULL,
    "endSeasonStartYear" INTEGER NOT NULL,
    "rfaOnExpiry" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractYear" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "salary" INTEGER NOT NULL,
    "capHit" INTEGER NOT NULL,
    "optionType" "ContractOptionType",
    "guaranteeType" "GuaranteeType" NOT NULL DEFAULT 'full',
    "guaranteedAmount" INTEGER,

    CONSTRAINT "ContractYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadMoney" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "isStretched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadMoney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapHold" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "leaguePlayerId" INTEGER NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "isQualifyingOffer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaguePlayer_leagueId_teamId_idx" ON "LeaguePlayer"("leagueId", "teamId");

-- CreateIndex
CREATE INDEX "LeaguePlayer_leagueId_status_idx" ON "LeaguePlayer"("leagueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LeaguePlayer_leagueId_playerId_key" ON "LeaguePlayer"("leagueId", "playerId");

-- CreateIndex
CREATE INDEX "Contract_leagueId_teamId_idx" ON "Contract"("leagueId", "teamId");

-- CreateIndex
CREATE INDEX "Contract_leaguePlayerId_idx" ON "Contract"("leaguePlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractYear_contractId_seasonStartYear_key" ON "ContractYear"("contractId", "seasonStartYear");

-- CreateIndex
CREATE INDEX "DeadMoney_leagueId_teamId_idx" ON "DeadMoney"("leagueId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "DeadMoney_leagueId_teamId_playerId_seasonStartYear_key" ON "DeadMoney"("leagueId", "teamId", "playerId", "seasonStartYear");

-- CreateIndex
CREATE INDEX "CapHold_leagueId_teamId_idx" ON "CapHold"("leagueId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "CapHold_leaguePlayerId_seasonStartYear_key" ON "CapHold"("leaguePlayerId", "seasonStartYear");

-- AddForeignKey
ALTER TABLE "LeaguePlayer" ADD CONSTRAINT "LeaguePlayer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaguePlayer" ADD CONSTRAINT "LeaguePlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaguePlayer" ADD CONSTRAINT "LeaguePlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_leaguePlayerId_fkey" FOREIGN KEY ("leaguePlayerId") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractYear" ADD CONSTRAINT "ContractYear_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadMoney" ADD CONSTRAINT "DeadMoney_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadMoney" ADD CONSTRAINT "DeadMoney_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadMoney" ADD CONSTRAINT "DeadMoney_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapHold" ADD CONSTRAINT "CapHold_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapHold" ADD CONSTRAINT "CapHold_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapHold" ADD CONSTRAINT "CapHold_leaguePlayerId_fkey" FOREIGN KEY ("leaguePlayerId") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
