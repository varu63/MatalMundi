-- AI-image screening columns on marketplace listings (warn-only; never blocks).
ALTER TABLE "marketplace_listings"
  ADD COLUMN "imageCheckStatus"   TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "imageCheckFlagged"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "imageCheckMaxScore" DOUBLE PRECISION,
  ADD COLUMN "imageCheckPerImage" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "imageCheckError"    TEXT,
  ADD COLUMN "imageCheckedAt"     TIMESTAMP(3);

CREATE INDEX "marketplace_listings_imageCheckFlagged_idx"
  ON "marketplace_listings"("imageCheckFlagged");
