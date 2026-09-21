-- v2 maps/sub-maps/per-context verification/projects, superseded by the content chart.
DROP TABLE IF EXISTS "project_items";
DROP TABLE IF EXISTS "projects";
DROP TABLE IF EXISTS "concept_verification_contexts";
DROP TABLE IF EXISTS "concept_includes";
ALTER TABLE "chart_node_settings" DROP COLUMN IF EXISTS "pinned";
