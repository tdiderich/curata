-- Per-edge verification on page->concept edges. A page that depends on two
-- concepts is checked for each separately.
ALTER TABLE "page_concepts" ADD COLUMN "verified_at" TIMESTAMP(3);
ALTER TABLE "page_concepts" ADD COLUMN "verified_note" TEXT;
ALTER TABLE "page_concepts" ADD COLUMN "needs_change" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: an existing edge was last "looked at" when its page was last written.
UPDATE "page_concepts" pc SET "verified_at" = p."updated_at"
  FROM "pages" p WHERE p."id" = pc."page_id" AND pc."verified_at" IS NULL;

-- Assets outside curata: one row per normalized url per org...
CREATE TABLE "external_assets" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "owner" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_assets_org_id_url_key" ON "external_assets"("org_id", "url");

-- ...and one edge per (asset, concept) carrying its own verification.
CREATE TABLE "external_edges" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "rel" TEXT NOT NULL DEFAULT 'depends',
    "verified_at" TIMESTAMP(3),
    "verified_note" TEXT,
    "needs_change" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_edges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_edges_asset_id_concept_id_key" ON "external_edges"("asset_id", "concept_id");
CREATE INDEX "external_edges_concept_id_idx" ON "external_edges"("concept_id");
ALTER TABLE "external_edges" ADD CONSTRAINT "external_edges_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "external_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_edges" ADD CONSTRAINT "external_edges_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
