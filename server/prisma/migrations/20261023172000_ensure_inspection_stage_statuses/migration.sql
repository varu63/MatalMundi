-- Idempotent guard for the inspection-stage order statuses.
--
-- A database where 20261023170000 was recorded as applied before these labels
-- were added (drift, not a fresh install) otherwise cannot insert the new
-- statuses at all. Re-issuing them with IF NOT EXISTS is a no-op everywhere
-- else, and this migration must come after 20261023171000 so it never runs in
-- the same transaction as a statement using the labels.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'INSPECTION_SCHEDULED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'INSPECTION_IN_PROGRESS';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERY_CHARGE_PENDING';
