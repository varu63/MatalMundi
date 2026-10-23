-- Backfill: an order whose inspection had already been scheduled or started
-- should show that stage in its status, so admin queues filter correctly.
UPDATE "orders" AS o
SET "status" = CASE
    WHEN i."status" = 'IN_PROGRESS' THEN 'INSPECTION_IN_PROGRESS'::"OrderStatus"
    ELSE 'INSPECTION_SCHEDULED'::"OrderStatus"
  END
FROM "inspections" AS i
WHERE i."orderId" = o."id"
  AND o."status" IN ('ACCEPTED', 'PENDING_ADMIN_APPROVAL')
  AND i."status" IN ('SCHEDULED', 'IN_PROGRESS');
