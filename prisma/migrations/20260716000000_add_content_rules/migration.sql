-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "rules" JSONB;

-- AlterTable
ALTER TABLE "folders" ADD COLUMN     "rules" JSONB;

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "rules" JSONB;

-- CreateIndex
CREATE INDEX "folders_parent_id_idx" ON "folders"("parent_id");
