-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('PENDING', 'SCHEDULED', 'IN_PROGRESS', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryChargeStatus" AS ENUM ('NOT_SET', 'AWAITING_BUYER_CONFIRMATION', 'CONFIRMED', 'REJECTED');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_BUYER_CONFIRMATION';

-- AlterTable
ALTER TABLE "inventory_lots" ADD COLUMN     "city" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "state" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "marketplace_listings" ADD COLUMN     "city" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "state" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "addressReleaseReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "addressReleased" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "addressReleasedAt" TIMESTAMP(3),
ADD COLUMN     "addressReleasedById" TEXT,
ADD COLUMN     "buyerConfirmationNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "buyerConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryChargeNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deliveryChargePaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryChargeSetAt" TIMESTAMP(3),
ADD COLUMN     "deliveryChargeSetById" TEXT,
ADD COLUMN     "deliveryChargeStatus" "DeliveryChargeStatus" NOT NULL DEFAULT 'NOT_SET',
ADD COLUMN     "inspectionStatus" "InspectionStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "sellerId" TEXT;

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "inspectorId" TEXT,
    "status" "InspectionStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "failureReason" TEXT NOT NULL DEFAULT '',
    "photos" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inspections_orderId_key" ON "inspections"("orderId");

-- CreateIndex
CREATE INDEX "inspections_status_scheduledAt_idx" ON "inspections"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "orders_sellerId_createdAt_idx" ON "orders"("sellerId", "createdAt");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_deliveryChargeSetById_fkey" FOREIGN KEY ("deliveryChargeSetById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_addressReleasedById_fkey" FOREIGN KEY ("addressReleasedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
