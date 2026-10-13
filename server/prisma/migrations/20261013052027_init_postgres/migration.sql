-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING_APPROVAL', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'COLLECTED', 'PURCHASED');

-- CreateEnum
CREATE TYPE "QualityGrade" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "MaterialCondition" AS ENUM ('LOOSE', 'BALED', 'SHREDDED', 'MIXED', 'USED');

-- CreateEnum
CREATE TYPE "DemandBasis" AS ENUM ('TOTAL', 'PER_KG');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('ACCEPTED', 'PUBLISHED', 'DEPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_ADMIN_APPROVAL', 'ACCEPTED', 'REJECTED', 'CONFIRMED', 'PROCESSING', 'READY_FOR_DISPATCH', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('IN', 'RESERVE', 'RELEASE', 'COMMIT', 'ADJUST');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SUBMISSION', 'ORDER', 'ACCOUNT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'REFUNDED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "address" JSONB NOT NULL DEFAULT '{}',
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerificationVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationToken" TEXT,
    "emailVerificationExpiresAt" TIMESTAMP(3),
    "passwordResetToken" TEXT,
    "passwordResetExpiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT 'recycle',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_configurations" (
    "id" TEXT NOT NULL,
    "materialCategoryId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL DEFAULT '',
    "ratePerKgPaise" INTEGER NOT NULL,
    "qualityMultipliers" JSONB NOT NULL DEFAULT '{}',
    "basePickupChargePaise" INTEGER NOT NULL DEFAULT 50000,
    "perKmChargePaise" INTEGER NOT NULL DEFAULT 1200,
    "platformFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "taxPercent" DOUBLE PRECISION NOT NULL DEFAULT 18,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_submissions" (
    "id" TEXT NOT NULL,
    "submissionNumber" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "materialCategoryId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "condition" "MaterialCondition" NOT NULL,
    "qualityGrade" "QualityGrade" NOT NULL,
    "description" TEXT NOT NULL,
    "images" JSONB NOT NULL,
    "pickup" JSONB NOT NULL,
    "demandBasis" "DemandBasis" NOT NULL,
    "demandedTotalPaise" INTEGER NOT NULL DEFAULT 0,
    "demandedPerKgPaise" INTEGER NOT NULL DEFAULT 0,
    "valuation" JSONB NOT NULL DEFAULT '{}',
    "proposedPurchasePricePaise" INTEGER NOT NULL DEFAULT 0,
    "proposedPurchasePriceSetById" TEXT,
    "proposedPurchasePriceSetAt" TIMESTAMP(3),
    "acceptedQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "adminNotes" JSONB NOT NULL DEFAULT '[]',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "collectedById" TEXT,
    "collectedAt" TIMESTAMP(3),
    "pickupDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waste_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lots" (
    "id" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "sourceSubmissionId" TEXT,
    "sellerId" TEXT NOT NULL,
    "materialCategoryId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "qualityGrade" "QualityGrade" NOT NULL,
    "condition" "MaterialCondition" NOT NULL,
    "acceptedQuantityKg" DOUBLE PRECISION NOT NULL,
    "availableQuantityKg" DOUBLE PRECISION NOT NULL,
    "reservedQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "soldQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "location" JSONB NOT NULL DEFAULT '{}',
    "lotStatus" "LotStatus" NOT NULL DEFAULT 'ACCEPTED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "materialCategoryId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "inventoryLotId" TEXT NOT NULL,
    "sourceSubmissionId" TEXT,
    "qualityGrade" "QualityGrade" NOT NULL,
    "condition" "MaterialCondition" NOT NULL,
    "pricePerKgPaise" INTEGER NOT NULL,
    "minPurchaseKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "acceptedQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availableQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "soldQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "location" JSONB NOT NULL DEFAULT '{}',
    "deliveryTerms" TEXT NOT NULL DEFAULT 'Pickup from MetalMundi facility',
    "publicationStatus" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "delivery" JSONB NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "materialSubtotalPaise" INTEGER NOT NULL,
    "taxPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxPaise" INTEGER NOT NULL DEFAULT 0,
    "transportationPaise" INTEGER NOT NULL DEFAULT 0,
    "otherFeesPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "quoteIsProvisional" BOOLEAN NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_ADMIN_APPROVAL',
    "statusHistory" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "adminNotes" TEXT NOT NULL DEFAULT '',
    "inventoryReserved" BOOLEAN NOT NULL DEFAULT false,
    "inventoryCommitted" BOOLEAN NOT NULL DEFAULT false,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentProvider" TEXT NOT NULL DEFAULT '',
    "paymentReference" TEXT NOT NULL DEFAULT '',
    "paymentPaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM',
    "relatedType" TEXT NOT NULL DEFAULT '',
    "relatedId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "meta" JSONB,
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "balanceAvailableKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceReservedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceSoldKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',
    "orderId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_accountStatus_idx" ON "users"("role", "accountStatus");

-- CreateIndex
CREATE UNIQUE INDEX "material_categories_name_key" ON "material_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "material_categories_slug_key" ON "material_categories"("slug");

-- CreateIndex
CREATE INDEX "material_categories_active_idx" ON "material_categories"("active");

-- CreateIndex
CREATE INDEX "pricing_configurations_materialCategoryId_materialType_acti_idx" ON "pricing_configurations"("materialCategoryId", "materialType", "active", "version");

-- CreateIndex
CREATE UNIQUE INDEX "waste_submissions_submissionNumber_key" ON "waste_submissions"("submissionNumber");

-- CreateIndex
CREATE INDEX "waste_submissions_status_createdAt_idx" ON "waste_submissions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "waste_submissions_sellerId_createdAt_idx" ON "waste_submissions"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "waste_submissions_materialCategoryId_materialType_idx" ON "waste_submissions"("materialCategoryId", "materialType");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lots_lotNumber_key" ON "inventory_lots"("lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lots_sourceSubmissionId_key" ON "inventory_lots"("sourceSubmissionId");

-- CreateIndex
CREATE INDEX "inventory_lots_materialCategoryId_materialType_lotStatus_idx" ON "inventory_lots"("materialCategoryId", "materialType", "lotStatus");

-- CreateIndex
CREATE INDEX "inventory_lots_availableQuantityKg_idx" ON "inventory_lots"("availableQuantityKg");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listings_inventoryLotId_key" ON "marketplace_listings"("inventoryLotId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listings_sourceSubmissionId_key" ON "marketplace_listings"("sourceSubmissionId");

-- CreateIndex
CREATE INDEX "marketplace_listings_active_publicationStatus_availableQuan_idx" ON "marketplace_listings"("active", "publicationStatus", "availableQuantityKg");

-- CreateIndex
CREATE INDEX "marketplace_listings_pricePerKgPaise_idx" ON "marketplace_listings"("pricePerKgPaise");

-- CreateIndex
CREATE INDEX "marketplace_listings_createdAt_idx" ON "marketplace_listings"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_buyerId_createdAt_idx" ON "orders"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_read_createdAt_idx" ON "notifications"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_createdAt_idx" ON "audit_logs"("resourceType", "resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_movements_lotId_createdAt_idx" ON "inventory_movements"("lotId", "createdAt");

-- AddForeignKey
ALTER TABLE "pricing_configurations" ADD CONSTRAINT "pricing_configurations_materialCategoryId_fkey" FOREIGN KEY ("materialCategoryId") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_configurations" ADD CONSTRAINT "pricing_configurations_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_submissions" ADD CONSTRAINT "waste_submissions_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_submissions" ADD CONSTRAINT "waste_submissions_materialCategoryId_fkey" FOREIGN KEY ("materialCategoryId") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_submissions" ADD CONSTRAINT "waste_submissions_proposedPurchasePriceSetById_fkey" FOREIGN KEY ("proposedPurchasePriceSetById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_submissions" ADD CONSTRAINT "waste_submissions_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_submissions" ADD CONSTRAINT "waste_submissions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_submissions" ADD CONSTRAINT "waste_submissions_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "waste_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_materialCategoryId_fkey" FOREIGN KEY ("materialCategoryId") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_materialCategoryId_fkey" FOREIGN KEY ("materialCategoryId") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "waste_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
