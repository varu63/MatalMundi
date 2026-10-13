-- CreateEnum
CREATE TYPE "SaleMode" AS ENUM ('NORMAL', 'AUCTION');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'ENDED', 'AWAITING_PAYMENT', 'AWAITING_PICKUP', 'COMPLETED', 'CANCELLED', 'NO_BIDS');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('LEADING', 'OUTBID', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "BidIncrementType" AS ENUM ('FIXED', 'PERCENT');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AUCTION';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "auctionId" TEXT;

-- AlterTable
ALTER TABLE "waste_submissions" ADD COLUMN     "saleMode" "SaleMode" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "waste_auctions" (
    "id" TEXT NOT NULL,
    "auctionNumber" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "materialCategoryId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "condition" "MaterialCondition" NOT NULL,
    "qualityGrade" "QualityGrade" NOT NULL,
    "images" JSONB NOT NULL DEFAULT '{}',
    "location" JSONB NOT NULL DEFAULT '{}',
    "inspectionNotes" TEXT NOT NULL DEFAULT '',
    "startingPricePerKgPaise" INTEGER NOT NULL,
    "expectedPricePerKgPaise" INTEGER NOT NULL DEFAULT 0,
    "minAcceptableBidPerKgPaise" INTEGER NOT NULL DEFAULT 0,
    "reservePricePerKgPaise" INTEGER,
    "minIncrementType" "BidIncrementType" NOT NULL DEFAULT 'FIXED',
    "minIncrementValue" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "antiSnipingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "antiSnipingWindowSeconds" INTEGER NOT NULL DEFAULT 30,
    "antiSnipingExtensionSeconds" INTEGER NOT NULL DEFAULT 60,
    "durationMinutes" INTEGER NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "extensionCount" INTEGER NOT NULL DEFAULT 0,
    "currentHighestBidPerKgPaise" INTEGER,
    "currentHighestBidId" TEXT,
    "currentHighestBidderId" TEXT,
    "bidCount" INTEGER NOT NULL DEFAULT 0,
    "bidderCount" INTEGER NOT NULL DEFAULT 0,
    "winnerId" TEXT,
    "winningBidId" TEXT,
    "winningBidPerKgPaise" INTEGER,
    "winningTotalPaise" INTEGER,
    "winnerSelectionReason" TEXT NOT NULL DEFAULT '',
    "settlement" JSONB NOT NULL DEFAULT '{}',
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "cancellationReason" TEXT NOT NULL DEFAULT '',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waste_auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_auction_bids" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "bidPerKgPaise" INTEGER NOT NULL,
    "totalBidValuePaise" INTEGER NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'LEADING',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_auction_bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_settings" (
    "id" TEXT NOT NULL,
    "minAuctionQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "sellerCanChooseDuration" BOOLEAN NOT NULL DEFAULT true,
    "defaultDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "minDurationMinutes" INTEGER NOT NULL DEFAULT 10,
    "maxDurationMinutes" INTEGER NOT NULL DEFAULT 1440,
    "allowedDurationsMinutes" JSONB NOT NULL DEFAULT '[10,15,30,60]',
    "minIncrementType" "BidIncrementType" NOT NULL DEFAULT 'FIXED',
    "minIncrementValue" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "antiSnipingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "antiSnipingWindowSeconds" INTEGER NOT NULL DEFAULT 30,
    "antiSnipingExtensionSeconds" INTEGER NOT NULL DEFAULT 60,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auction_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waste_auctions_auctionNumber_key" ON "waste_auctions"("auctionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "waste_auctions_submissionId_key" ON "waste_auctions"("submissionId");

-- CreateIndex
CREATE INDEX "waste_auctions_status_endAt_idx" ON "waste_auctions"("status", "endAt");

-- CreateIndex
CREATE INDEX "waste_auctions_status_startAt_idx" ON "waste_auctions"("status", "startAt");

-- CreateIndex
CREATE INDEX "waste_auctions_sellerId_createdAt_idx" ON "waste_auctions"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "waste_auctions_materialCategoryId_materialType_status_idx" ON "waste_auctions"("materialCategoryId", "materialType", "status");

-- CreateIndex
CREATE INDEX "waste_auction_bids_auctionId_createdAt_idx" ON "waste_auction_bids"("auctionId", "createdAt");

-- CreateIndex
CREATE INDEX "waste_auction_bids_bidderId_createdAt_idx" ON "waste_auction_bids"("bidderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "waste_auction_bids_auctionId_idempotencyKey_key" ON "waste_auction_bids"("auctionId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "orders_auctionId_key" ON "orders"("auctionId");

-- CreateIndex
CREATE INDEX "waste_submissions_saleMode_status_idx" ON "waste_submissions"("saleMode", "status");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "waste_auctions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_auctions" ADD CONSTRAINT "waste_auctions_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "waste_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_auctions" ADD CONSTRAINT "waste_auctions_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_auctions" ADD CONSTRAINT "waste_auctions_materialCategoryId_fkey" FOREIGN KEY ("materialCategoryId") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_auctions" ADD CONSTRAINT "waste_auctions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_auctions" ADD CONSTRAINT "waste_auctions_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_auctions" ADD CONSTRAINT "waste_auctions_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_auctions" ADD CONSTRAINT "waste_auctions_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_auction_bids" ADD CONSTRAINT "waste_auction_bids_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "waste_auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_auction_bids" ADD CONSTRAINT "waste_auction_bids_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_settings" ADD CONSTRAINT "auction_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

