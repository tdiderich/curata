ALTER TABLE "organizations" ADD COLUMN "ignored_domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "external_refs" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "external_refs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_refs_page_id_asset_id_key" ON "external_refs"("page_id", "asset_id");
CREATE INDEX "external_refs_asset_id_idx" ON "external_refs"("asset_id");
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "external_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
