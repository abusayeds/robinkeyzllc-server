-- AlterTable
ALTER TABLE "TradeAsset" ADD COLUMN     "protectedTopN" INTEGER,
ADD COLUMN     "protectionFinalYear" INTEGER,
ADD COLUMN     "protectionNote" TEXT,
ADD COLUMN     "protectionOutcome" "PickProtectionOutcome";
