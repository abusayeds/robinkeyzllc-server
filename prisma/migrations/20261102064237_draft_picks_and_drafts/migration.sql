-- CreateEnum
CREATE TYPE "DraftKind" AS ENUM ('startup', 'rookie');

-- CreateEnum
CREATE TYPE "DraftFormat" AS ENUM ('snake', 'linear');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('scheduled', 'inProgress', 'complete');

-- CreateEnum
CREATE TYPE "PickProtectionOutcome" AS ENUM ('rollover', 'convert', 'end');

-- AlterEnum
ALTER TYPE "TradeAssetKind" ADD VALUE 'draftPick';

-- AlterTable
ALTER TABLE "LeagueSettings" ADD COLUMN     "pickTradingWindowDrafts" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "TradeAsset" ADD COLUMN     "draftPickId" INTEGER;

-- CreateTable
CREATE TABLE "LeagueDraft" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "kind" "DraftKind" NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "rounds" INTEGER NOT NULL DEFAULT 2,
    "format" "DraftFormat" NOT NULL DEFAULT 'snake',
    "reversalRound" INTEGER NOT NULL DEFAULT 2,
    "startsAt" TIMESTAMP(3),
    "timezone" TEXT,
    "pickSeconds" INTEGER NOT NULL DEFAULT 120,
    "autoSetOrder" BOOLEAN NOT NULL DEFAULT false,
    "status" "DraftStatus" NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftOrderSlot" (
    "id" SERIAL NOT NULL,
    "draftId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "pickInRound" INTEGER NOT NULL,
    "overall" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "draftPickId" INTEGER,
    "playerId" INTEGER,
    "pickedAt" TIMESTAMP(3),

    CONSTRAINT "DraftOrderSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPick" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "originalTeamId" INTEGER NOT NULL,
    "currentTeamId" INTEGER NOT NULL,
    "protectedTopN" INTEGER,
    "protectionOutcome" "PickProtectionOutcome",
    "protectionFinalYear" INTEGER,
    "convertsToPickId" INTEGER,
    "owedToTeamId" INTEGER,
    "frozenInSeason" INTEGER,
    "movedToEndOfRound" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPickEvent" (
    "id" SERIAL NOT NULL,
    "pickId" INTEGER NOT NULL,
    "fromTeamId" INTEGER,
    "toTeamId" INTEGER NOT NULL,
    "reason" TEXT,
    "tradeId" INTEGER,
    "actorUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftPickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueDraft_leagueId_idx" ON "LeagueDraft"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueDraft_leagueId_kind_seasonStartYear_key" ON "LeagueDraft"("leagueId", "kind", "seasonStartYear");

-- CreateIndex
CREATE INDEX "DraftOrderSlot_draftId_round_idx" ON "DraftOrderSlot"("draftId", "round");

-- CreateIndex
CREATE INDEX "DraftOrderSlot_teamId_idx" ON "DraftOrderSlot"("teamId");

-- CreateIndex
CREATE INDEX "DraftOrderSlot_draftPickId_idx" ON "DraftOrderSlot"("draftPickId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftOrderSlot_draftId_overall_key" ON "DraftOrderSlot"("draftId", "overall");

-- CreateIndex
CREATE INDEX "DraftPick_leagueId_seasonStartYear_idx" ON "DraftPick"("leagueId", "seasonStartYear");

-- CreateIndex
CREATE INDEX "DraftPick_currentTeamId_idx" ON "DraftPick"("currentTeamId");

-- CreateIndex
CREATE INDEX "DraftPick_originalTeamId_idx" ON "DraftPick"("originalTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_leagueId_seasonStartYear_round_originalTeamId_key" ON "DraftPick"("leagueId", "seasonStartYear", "round", "originalTeamId");

-- CreateIndex
CREATE INDEX "DraftPickEvent_pickId_idx" ON "DraftPickEvent"("pickId");

-- CreateIndex
CREATE INDEX "DraftPickEvent_tradeId_idx" ON "DraftPickEvent"("tradeId");

-- CreateIndex
CREATE INDEX "TradeAsset_draftPickId_idx" ON "TradeAsset"("draftPickId");

-- AddForeignKey
ALTER TABLE "LeagueDraft" ADD CONSTRAINT "LeagueDraft_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftOrderSlot" ADD CONSTRAINT "DraftOrderSlot_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "LeagueDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftOrderSlot" ADD CONSTRAINT "DraftOrderSlot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftOrderSlot" ADD CONSTRAINT "DraftOrderSlot_draftPickId_fkey" FOREIGN KEY ("draftPickId") REFERENCES "DraftPick"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftOrderSlot" ADD CONSTRAINT "DraftOrderSlot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_originalTeamId_fkey" FOREIGN KEY ("originalTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_currentTeamId_fkey" FOREIGN KEY ("currentTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_owedToTeamId_fkey" FOREIGN KEY ("owedToTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_convertsToPickId_fkey" FOREIGN KEY ("convertsToPickId") REFERENCES "DraftPick"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPickEvent" ADD CONSTRAINT "DraftPickEvent_pickId_fkey" FOREIGN KEY ("pickId") REFERENCES "DraftPick"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPickEvent" ADD CONSTRAINT "DraftPickEvent_fromTeamId_fkey" FOREIGN KEY ("fromTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPickEvent" ADD CONSTRAINT "DraftPickEvent_toTeamId_fkey" FOREIGN KEY ("toTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPickEvent" ADD CONSTRAINT "DraftPickEvent_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPickEvent" ADD CONSTRAINT "DraftPickEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAsset" ADD CONSTRAINT "TradeAsset_draftPickId_fkey" FOREIGN KEY ("draftPickId") REFERENCES "DraftPick"("id") ON DELETE SET NULL ON UPDATE CASCADE;
