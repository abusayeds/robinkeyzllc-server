-- CreateTable
CREATE TABLE "PlayerContractReference" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "salary" INTEGER NOT NULL,
    "optionType" "ContractOptionType",
    "guaranteeType" "GuaranteeType" NOT NULL DEFAULT 'full',
    "guaranteedAmount" INTEGER,
    "endSeasonStartYear" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'superAdmin',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerContractReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerContractReference_seasonStartYear_idx" ON "PlayerContractReference"("seasonStartYear");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerContractReference_playerId_seasonStartYear_key" ON "PlayerContractReference"("playerId", "seasonStartYear");

-- AddForeignKey
ALTER TABLE "PlayerContractReference" ADD CONSTRAINT "PlayerContractReference_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
