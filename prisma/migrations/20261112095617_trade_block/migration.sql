-- CreateTable
CREATE TABLE "TradeBlockEntry" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "leaguePlayerId" INTEGER NOT NULL,
    "note" TEXT,
    "listedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeBlockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeBlockEntry_leagueId_createdAt_idx" ON "TradeBlockEntry"("leagueId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeBlockEntry_leagueId_teamId_idx" ON "TradeBlockEntry"("leagueId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeBlockEntry_leaguePlayerId_key" ON "TradeBlockEntry"("leaguePlayerId");

-- AddForeignKey
ALTER TABLE "TradeBlockEntry" ADD CONSTRAINT "TradeBlockEntry_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBlockEntry" ADD CONSTRAINT "TradeBlockEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBlockEntry" ADD CONSTRAINT "TradeBlockEntry_leaguePlayerId_fkey" FOREIGN KEY ("leaguePlayerId") REFERENCES "LeaguePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBlockEntry" ADD CONSTRAINT "TradeBlockEntry_listedById_fkey" FOREIGN KEY ("listedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
