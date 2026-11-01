-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('proposed', 'accepted', 'awaitingApproval', 'approved', 'rejected', 'declined', 'withdrawn', 'processed');

-- CreateEnum
CREATE TYPE "TradeResponse" AS ENUM ('pending', 'accepted', 'declined');

-- CreateEnum
CREATE TYPE "TradeAssetKind" AS ENUM ('player', 'tradeException');

-- CreateTable
CREATE TABLE "Trade" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "proposedById" INTEGER,
    "status" "TradeStatus" NOT NULL DEFAULT 'proposed',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "checks" JSONB NOT NULL,
    "message" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeTeam" (
    "id" SERIAL NOT NULL,
    "tradeId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "response" "TradeResponse" NOT NULL DEFAULT 'pending',
    "respondedById" INTEGER,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TradeTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeAsset" (
    "id" SERIAL NOT NULL,
    "tradeId" INTEGER NOT NULL,
    "fromTeamId" INTEGER NOT NULL,
    "toTeamId" INTEGER NOT NULL,
    "kind" "TradeAssetKind" NOT NULL,
    "leaguePlayerId" INTEGER,
    "tradeExceptionId" INTEGER,
    "salary" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TradeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeException" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceTradeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trade_leagueId_status_idx" ON "Trade"("leagueId", "status");

-- CreateIndex
CREATE INDEX "TradeTeam_teamId_response_idx" ON "TradeTeam"("teamId", "response");

-- CreateIndex
CREATE UNIQUE INDEX "TradeTeam_tradeId_teamId_key" ON "TradeTeam"("tradeId", "teamId");

-- CreateIndex
CREATE INDEX "TradeAsset_tradeId_idx" ON "TradeAsset"("tradeId");

-- CreateIndex
CREATE INDEX "TradeAsset_leaguePlayerId_idx" ON "TradeAsset"("leaguePlayerId");

-- CreateIndex
CREATE INDEX "TradeException_leagueId_teamId_isActive_idx" ON "TradeException"("leagueId", "teamId", "isActive");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTeam" ADD CONSTRAINT "TradeTeam_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTeam" ADD CONSTRAINT "TradeTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTeam" ADD CONSTRAINT "TradeTeam_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAsset" ADD CONSTRAINT "TradeAsset_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAsset" ADD CONSTRAINT "TradeAsset_fromTeamId_fkey" FOREIGN KEY ("fromTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAsset" ADD CONSTRAINT "TradeAsset_toTeamId_fkey" FOREIGN KEY ("toTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAsset" ADD CONSTRAINT "TradeAsset_leaguePlayerId_fkey" FOREIGN KEY ("leaguePlayerId") REFERENCES "LeaguePlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAsset" ADD CONSTRAINT "TradeAsset_tradeExceptionId_fkey" FOREIGN KEY ("tradeExceptionId") REFERENCES "TradeException"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeException" ADD CONSTRAINT "TradeException_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeException" ADD CONSTRAINT "TradeException_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeException" ADD CONSTRAINT "TradeException_sourceTradeId_fkey" FOREIGN KEY ("sourceTradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
