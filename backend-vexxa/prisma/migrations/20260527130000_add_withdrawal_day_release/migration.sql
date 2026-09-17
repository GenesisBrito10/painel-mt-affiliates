-- CreateTable
CREATE TABLE "withdrawal_day_releases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bettingHouse" TEXT NOT NULL,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_day_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "withdrawal_day_releases_lookup_idx" ON "withdrawal_day_releases"("userId", "bettingHouse", "releaseDate", "consumedAt");

-- AddForeignKey
ALTER TABLE "withdrawal_day_releases" ADD CONSTRAINT "withdrawal_day_releases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
