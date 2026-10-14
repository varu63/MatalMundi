-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "marketplace_listings_materialCategoryId_active_publicationS_idx" ON "marketplace_listings"("materialCategoryId", "active", "publicationStatus");
