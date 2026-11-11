-- CreateEnum
CREATE TYPE "TeamIntelStatus" AS ENUM ('contending', 'rebuilding', 'buying', 'selling');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "intelStatus" "TeamIntelStatus";
