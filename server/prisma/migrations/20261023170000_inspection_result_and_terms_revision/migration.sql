-- Inspection outcome records the weighed-out quantity and observed condition;
-- orders gained the inspection-stage statuses the workflow moves them through,
-- plus a counter for terms revisions the buyer has to re-confirm.

-- AlterEnum: PostgreSQL can only append enum labels, so the new order statuses
-- are added at the end. Prisma's declared order is display-only. These run in
-- their own migration because a new enum label cannot be used in the same
-- transaction that creates it.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'INSPECTION_SCHEDULED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'INSPECTION_IN_PROGRESS';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERY_CHARGE_PENDING';

-- AlterTable
ALTER TABLE "inspections" ADD COLUMN "actualQuantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "materialCondition" "MaterialCondition" NOT NULL DEFAULT 'LOOSE',
ADD COLUMN "quantityChangedFromKg" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "termsRevision" INTEGER NOT NULL DEFAULT 0;
