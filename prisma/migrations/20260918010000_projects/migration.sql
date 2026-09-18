CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "cloned_from" TEXT,
    "title" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "projects_org_id_term_key" ON "projects"("org_id", "term");

CREATE TABLE "project_items" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "page_concept_id" TEXT,
    "external_edge_id" TEXT,
    "owner" TEXT,
    "due_date" TIMESTAMP(3),
    "done" BOOLEAN NOT NULL DEFAULT false,
    "done_at" TIMESTAMP(3),
    "done_by" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_items_project_id_page_concept_id_key" ON "project_items"("project_id", "page_concept_id");
CREATE UNIQUE INDEX "project_items_project_id_external_edge_id_key" ON "project_items"("project_id", "external_edge_id");
CREATE INDEX "project_items_project_id_idx" ON "project_items"("project_id");
ALTER TABLE "project_items" ADD CONSTRAINT "project_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_items" ADD CONSTRAINT "project_items_page_concept_id_fkey" FOREIGN KEY ("page_concept_id") REFERENCES "page_concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_items" ADD CONSTRAINT "project_items_external_edge_id_fkey" FOREIGN KEY ("external_edge_id") REFERENCES "external_edges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
