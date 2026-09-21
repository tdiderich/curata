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

ALTER TABLE "external_edges" ADD COLUMN "due_at" TIMESTAMP(3);

CREATE TABLE "chart_node_settings" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chart_node_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chart_node_settings_org_id_concept_id_key" ON "chart_node_settings"("org_id", "concept_id");
ALTER TABLE "chart_node_settings" ADD CONSTRAINT "chart_node_settings_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_assets" ADD COLUMN "check" JSONB;
