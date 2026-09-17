ALTER TABLE "pages" ADD COLUMN "verified_at" TIMESTAMP(3);
ALTER TABLE "pages" ADD COLUMN "verified_note" TEXT;

CREATE TABLE "external_dependents" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "owner" TEXT,
    "rel" TEXT NOT NULL DEFAULT 'depends',
    "verified_at" TIMESTAMP(3),
    "verified_note" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_dependents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_dependents_org_id_concept_id_url_key" ON "external_dependents"("org_id", "concept_id", "url");
CREATE INDEX "external_dependents_org_id_url_idx" ON "external_dependents"("org_id", "url");

ALTER TABLE "external_dependents" ADD CONSTRAINT "external_dependents_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: an existing page was last "looked at" when it was last written.
UPDATE "pages" SET "verified_at" = "updated_at" WHERE "verified_at" IS NULL;
