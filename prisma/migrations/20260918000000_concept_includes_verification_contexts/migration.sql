CREATE TABLE "concept_includes" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "concept_includes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "concept_includes_parent_id_child_id_key" ON "concept_includes"("parent_id", "child_id");
CREATE INDEX "concept_includes_child_id_idx" ON "concept_includes"("child_id");
ALTER TABLE "concept_includes" ADD CONSTRAINT "concept_includes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "concept_includes" ADD CONSTRAINT "concept_includes_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "concept_verification_contexts" (
    "id" TEXT NOT NULL,
    "edge_type" TEXT NOT NULL,
    "edge_id" TEXT NOT NULL,
    "context_concept_id" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "verified_note" TEXT,
    "needs_change" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "concept_verification_contexts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "concept_verification_contexts_edge_type_edge_id_context_conce" ON "concept_verification_contexts"("edge_type", "edge_id", "context_concept_id");
CREATE INDEX "concept_verification_contexts_context_concept_id_idx" ON "concept_verification_contexts"("context_concept_id");
ALTER TABLE "concept_verification_contexts" ADD CONSTRAINT "concept_verification_contexts_context_concept_id_fkey" FOREIGN KEY ("context_concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
