-- CreateTable
CREATE TABLE "NbaTeam" (
    "id" SERIAL NOT NULL,
    "bdlTeamId" INTEGER NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "conference" TEXT,
    "division" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "NbaTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" SERIAL NOT NULL,
    "bdlPlayerId" INTEGER,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "position" TEXT,
    "height" TEXT,
    "college" TEXT,
    "country" TEXT,
    "draftYear" INTEGER,
    "draftRound" INTEGER,
    "draftNumber" INTEGER,
    "nbaTeamId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "yearsOfService" INTEGER,
    "yearsOfServiceEstimated" BOOLEAN NOT NULL DEFAULT false,
    "birthdate" DATE,
    "headshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAlias" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasNormalized" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NbaTeam_bdlTeamId_key" ON "NbaTeam"("bdlTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_bdlPlayerId_key" ON "Player"("bdlPlayerId");

-- CreateIndex
CREATE INDEX "Player_nameNormalized_idx" ON "Player"("nameNormalized");

-- CreateIndex
CREATE INDEX "Player_lastName_firstName_idx" ON "Player"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Player_isActive_idx" ON "Player"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAlias_aliasNormalized_key" ON "PlayerAlias"("aliasNormalized");

-- CreateIndex
CREATE INDEX "PlayerAlias_playerId_idx" ON "PlayerAlias"("playerId");

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_nbaTeamId_fkey" FOREIGN KEY ("nbaTeamId") REFERENCES "NbaTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAlias" ADD CONSTRAINT "PlayerAlias_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAlias" ADD CONSTRAINT "PlayerAlias_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
