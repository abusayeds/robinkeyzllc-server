-- AlterTable
ALTER TABLE "LeagueSettings" ADD COLUMN     "customFirstApron" INTEGER,
ADD COLUMN     "customLuxuryTax" INTEGER,
ADD COLUMN     "customSalaryCap" INTEGER,
ADD COLUMN     "customSecondApron" INTEGER,
ADD COLUMN     "useCustomCapNumbers" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CapYear" (
    "id" SERIAL NOT NULL,
    "seasonStartYear" INTEGER NOT NULL,
    "salaryCap" INTEGER NOT NULL,
    "luxuryTax" INTEGER NOT NULL,
    "firstApron" INTEGER NOT NULL,
    "secondApron" INTEGER NOT NULL,
    "averagePlayerSalary" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapRuleSet" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "salaryFloorPct" DOUBLE PRECISION NOT NULL DEFAULT 90,
    "maxSalary0to6Pct" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "maxSalary7to9Pct" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "maxSalary10PlusPct" DOUBLE PRECISION NOT NULL DEFAULT 35,
    "stretchLimitPct" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "nonTaxpayerMlePct" DOUBLE PRECISION NOT NULL DEFAULT 9.12,
    "taxpayerMlePct" DOUBLE PRECISION NOT NULL DEFAULT 3.676,
    "roomExceptionPct" DOUBLE PRECISION NOT NULL DEFAULT 5.678,
    "biAnnualExceptionPct" DOUBLE PRECISION NOT NULL DEFAULT 3.32,
    "bandCushionPct" DOUBLE PRECISION NOT NULL DEFAULT 5.514,
    "tradeAllowance" INTEGER NOT NULL DEFAULT 250000,
    "tradeExceptionAllowance" INTEGER NOT NULL DEFAULT 250000,
    "qualifyingOfferAddOn" INTEGER NOT NULL DEFAULT 200000,
    "holdFullBirdAtOrAboveAvgPct" DOUBLE PRECISION NOT NULL DEFAULT 150,
    "holdFullBirdBelowAvgPct" DOUBLE PRECISION NOT NULL DEFAULT 190,
    "holdRookieAtOrAboveAvgPct" DOUBLE PRECISION NOT NULL DEFAULT 250,
    "holdRookieBelowAvgPct" DOUBLE PRECISION NOT NULL DEFAULT 300,
    "holdEarlyBirdPct" DOUBLE PRECISION NOT NULL DEFAULT 130,
    "holdNonBirdPct" DOUBLE PRECISION NOT NULL DEFAULT 120,
    "repeaterChargeSecondSeasonPct" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "repeaterChargeThirdSeasonPct" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "qualifyingOfferPriorSalaryPct" DOUBLE PRECISION NOT NULL DEFAULT 125,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinimumSalaryStep" (
    "id" SERIAL NOT NULL,
    "yearsOfService" INTEGER NOT NULL,
    "percentOfCap" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MinimumSalaryStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RookieScaleSlot" (
    "id" SERIAL NOT NULL,
    "pick" INTEGER NOT NULL,
    "year1PercentOfCap" DOUBLE PRECISION NOT NULL,
    "year4PercentOfYear1" DOUBLE PRECISION NOT NULL,
    "qoPercentOfYear1" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RookieScaleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondRoundScale" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "firstRoundYear2PercentOfYear1" DOUBLE PRECISION NOT NULL DEFAULT 105,
    "firstRoundYear3PercentOfYear1" DOUBLE PRECISION NOT NULL DEFAULT 110,
    "threeYearYear1PercentOfCap" DOUBLE PRECISION NOT NULL DEFAULT 1.3246,
    "threeYearYear2PercentOfYear1" DOUBLE PRECISION NOT NULL DEFAULT 105,
    "threeYearYear3PercentOfYear1" DOUBLE PRECISION NOT NULL DEFAULT 123.31,
    "fourYearYear1PercentOfCap" DOUBLE PRECISION NOT NULL DEFAULT 1.4848,
    "fourYearYear2PercentOfYear1" DOUBLE PRECISION NOT NULL DEFAULT 105,
    "fourYearYear3PercentOfYear1" DOUBLE PRECISION NOT NULL DEFAULT 110,
    "fourYearYear4PercentOfYear1" DOUBLE PRECISION NOT NULL DEFAULT 119.14,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecondRoundScale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CapYear_seasonStartYear_key" ON "CapYear"("seasonStartYear");

-- CreateIndex
CREATE INDEX "CapYear_seasonStartYear_idx" ON "CapYear"("seasonStartYear");

-- CreateIndex
CREATE UNIQUE INDEX "MinimumSalaryStep_yearsOfService_key" ON "MinimumSalaryStep"("yearsOfService");

-- CreateIndex
CREATE UNIQUE INDEX "RookieScaleSlot_pick_key" ON "RookieScaleSlot"("pick");
