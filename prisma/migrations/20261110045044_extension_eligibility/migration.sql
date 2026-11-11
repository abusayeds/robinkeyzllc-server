-- AlterTable
ALTER TABLE "LeaguePlayer" ADD COLUMN     "rookieMax30Eligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supermaxEligible" BOOLEAN NOT NULL DEFAULT false;
