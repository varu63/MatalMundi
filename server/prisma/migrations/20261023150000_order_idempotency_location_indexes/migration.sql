-- AlterTable
ALTER TABLE "orders" ADD COLUMN "idempotencyKey" TEXT;

-- Backfill locality from the existing JSON location payloads.
UPDATE "inventory_lots"
SET
  "city" = COALESCE("location"->>'city', ''),
  "state" = COALESCE("location"->>'state', ''),
  "latitude" = CASE
    WHEN ("location"->>'latitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN ("location"->>'latitude')::DOUBLE PRECISION
    ELSE "latitude"
  END,
  "longitude" = CASE
    WHEN ("location"->>'longitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN ("location"->>'longitude')::DOUBLE PRECISION
    ELSE "longitude"
  END
WHERE "city" = '' OR "state" = '' OR "latitude" IS NULL OR "longitude" IS NULL;

UPDATE "marketplace_listings"
SET
  "city" = COALESCE("location"->>'city', ''),
  "state" = COALESCE("location"->>'state', ''),
  "latitude" = CASE
    WHEN ("location"->>'latitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN ("location"->>'latitude')::DOUBLE PRECISION
    ELSE "latitude"
  END,
  "longitude" = CASE
    WHEN ("location"->>'longitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN ("location"->>'longitude')::DOUBLE PRECISION
    ELSE "longitude"
  END
WHERE "city" = '' OR "state" = '' OR "latitude" IS NULL OR "longitude" IS NULL;

UPDATE "marketplace_listings" AS listing
SET
  "city" = COALESCE(NULLIF(listing."city", ''), lot."city"),
  "state" = COALESCE(NULLIF(listing."state", ''), lot."state"),
  "latitude" = COALESCE(listing."latitude", lot."latitude"),
  "longitude" = COALESCE(listing."longitude", lot."longitude")
FROM "inventory_lots" AS lot
WHERE listing."inventoryLotId" = lot."id"
  AND (
    listing."city" = ''
    OR listing."state" = ''
    OR listing."latitude" IS NULL
    OR listing."longitude" IS NULL
  );

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "inventory_lots_city_state_idx" ON "inventory_lots"("city", "state");

-- CreateIndex
CREATE INDEX "inventory_lots_latitude_longitude_idx" ON "inventory_lots"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "marketplace_listings_city_state_idx" ON "marketplace_listings"("city", "state");

-- CreateIndex
CREATE INDEX "marketplace_listings_latitude_longitude_idx" ON "marketplace_listings"("latitude", "longitude");
