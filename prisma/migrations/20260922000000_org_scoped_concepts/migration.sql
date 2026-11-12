-- Org-scoped concepts.
--
-- Concepts (tags) used to be one global row per normalized_name, shared by
-- every org. After this migration each org owns its own rows:
-- unique (org_id, normalized_name), org_id NOT NULL.
--
-- For every concept used by more than one org the original row stays with ONE
-- org (the recommending org if there is one, else the org with the most
-- page_concepts rows, ties broken by lowest org_id) and every other org gets a
-- copy (new id, same normalized_name/display_name/kind, is_recommended false)
-- that its page_concepts, external_edges and chart_node_settings are re-pointed
-- to. Concepts no org uses are deleted. usage_count is recounted per row.
--
-- Meant to run once, in a single transaction (prisma migrate deploy does this).

-- Old global uniqueness has to go first: the copies below share a normalized_name.
DROP INDEX IF EXISTS "concepts_normalized_name_key";

-- (a) Every (concept, org) pair in use, restricted to orgs that exist.
CREATE TEMP TABLE _concept_orgs AS
SELECT concept_id, org_id FROM (
  SELECT pc.concept_id, p.org_id
    FROM page_concepts pc JOIN pages p ON p.id = pc.page_id
  UNION
  SELECT ee.concept_id, ea.org_id
    FROM external_edges ee JOIN external_assets ea ON ea.id = ee.asset_id
  UNION
  SELECT cns.concept_id, cns.org_id FROM chart_node_settings cns
  UNION
  SELECT c.id, c.org_id FROM concepts c WHERE c.is_recommended AND c.org_id IS NOT NULL
) u
WHERE org_id IN (SELECT id FROM organizations);

-- (b) Rank the orgs per concept: recommender first, then most page_concepts, then lowest org_id.
CREATE TEMP TABLE _concept_org_rank AS
SELECT co.concept_id,
       co.org_id,
       ROW_NUMBER() OVER (
         PARTITION BY co.concept_id
         ORDER BY (c.is_recommended AND c.org_id = co.org_id) DESC,
                  (SELECT COUNT(*) FROM page_concepts pc JOIN pages p ON p.id = pc.page_id
                    WHERE pc.concept_id = co.concept_id AND p.org_id = co.org_id) DESC,
                  co.org_id ASC
       ) AS rn
  FROM _concept_orgs co
  JOIN concepts c ON c.id = co.concept_id;

-- (c) A copy for every org that is not the keeper.
CREATE TEMP TABLE _concept_copies AS
SELECT concept_id, org_id, md5(concept_id || ':' || org_id || ':' || random()::text || clock_timestamp()::text) AS new_id
  FROM _concept_org_rank WHERE rn > 1;

INSERT INTO concepts (id, normalized_name, display_name, kind, usage_count, org_id, is_recommended, created_at, updated_at)
SELECT cc.new_id, c.normalized_name, c.display_name, c.kind, 0, cc.org_id, false, c.created_at, c.updated_at
  FROM _concept_copies cc JOIN concepts c ON c.id = cc.concept_id;

UPDATE page_concepts pc SET concept_id = cc.new_id
  FROM pages p, _concept_copies cc
 WHERE p.id = pc.page_id AND cc.concept_id = pc.concept_id AND cc.org_id = p.org_id;

UPDATE external_edges ee SET concept_id = cc.new_id
  FROM external_assets ea, _concept_copies cc
 WHERE ea.id = ee.asset_id AND cc.concept_id = ee.concept_id AND cc.org_id = ea.org_id;

UPDATE chart_node_settings cns SET concept_id = cc.new_id
  FROM _concept_copies cc
 WHERE cc.concept_id = cns.concept_id AND cc.org_id = cns.org_id;

-- (d) Originals go to their keeper org. A recommended flag survives only when
-- the recommender is the keeper.
UPDATE concepts c
   SET is_recommended = c.is_recommended AND c.org_id IS NOT DISTINCT FROM r.org_id,
       org_id = r.org_id
  FROM _concept_org_rank r
 WHERE r.concept_id = c.id AND r.rn = 1;

-- Concepts no org uses can still carry a stale org_id (older un-recommend paths
-- did not always null it, and that org may even be gone). Clear it so (e)
-- deletes them instead of leaving a dangling or unused row.
UPDATE concepts SET org_id = NULL
 WHERE id NOT IN (SELECT concept_id FROM _concept_org_rank WHERE rn = 1)
   AND id NOT IN (SELECT new_id FROM _concept_copies);

-- Rows left pointing at an org that no longer exists (assets/settings carry no FK)
-- cannot belong to any org's concept; drop them rather than leak across orgs.
DELETE FROM external_edges ee
 USING external_assets ea, concepts c
 WHERE ea.id = ee.asset_id AND c.id = ee.concept_id AND c.org_id IS NOT NULL AND c.org_id <> ea.org_id;
DELETE FROM chart_node_settings cns
 USING concepts c
 WHERE c.id = cns.concept_id AND c.org_id IS NOT NULL AND c.org_id <> cns.org_id;

-- (e) Concepts no org uses (org_id still NULL). Every concept referenced by a
-- page or by a live asset/setting got an org above, so this only cascades rows
-- that were already orphaned.
DELETE FROM concepts WHERE org_id IS NULL;

-- (f) usage_count is the number of page_concepts rows on this row.
UPDATE concepts c SET usage_count = (SELECT COUNT(*) FROM page_concepts pc WHERE pc.concept_id = c.id);

-- (g) New identity and constraints.
CREATE UNIQUE INDEX "concepts_org_id_normalized_name_key" ON "concepts"("org_id", "normalized_name");
ALTER TABLE "concepts" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE _concept_copies;
DROP TABLE _concept_org_rank;
DROP TABLE _concept_orgs;
