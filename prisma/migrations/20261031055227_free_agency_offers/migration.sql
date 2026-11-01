-- CreateEnum
CREATE TYPE "FreeAgencyOfferStatus" AS ENUM ('pending', 'accepted', 'declined', 'withdrawn', 'expired');

-- CreateTable
CREATE TABLE "FreeAgencyOffer" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "leaguePlayerId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "offeredById" INTEGER,
    "years" INTEGER NOT NULL,
    "firstYearSalary" INTEGER NOT NULL,
    "raisePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contractType" "ContractType" NOT NULL DEFAULT 'standard',
    "signedVia" "SignedVia" NOT NULL DEFAULT 'capSpace',
    "status" "FreeAgencyOfferStatus" NOT NULL DEFAULT 'pending',
    "checks" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreeAgencyOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FreeAgencyOffer_leagueId_status_idx" ON "FreeAgencyOffer"("leagueId", "status");

-- CreateIndex
CREATE INDEX "FreeAgencyOffer_teamId_status_idx" ON "FreeAgencyOffer"("teamId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FreeAgencyOffer_leaguePlayerId_teamId_key" ON "FreeAgencyOffer"("leaguePlayerId", "teamId");

-- AddForeignKey
ALTER TABLE "FreeAgencyOffer" ADD CONSTRAINT "FreeAgencyOffer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreeAgencyOffer" ADD CONSTRAINT "FreeAgencyOffer_leaguePlayerId_fkey" FOREIGN KEY ("leaguePlayerId") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreeAgencyOffer" ADD CONSTRAINT "FreeAgencyOffer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreeAgencyOffer" ADD CONSTRAINT "FreeAgencyOffer_offeredById_fkey" FOREIGN KEY ("offeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
