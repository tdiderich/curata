import { db } from "./db";
import { AUTH_MODE } from "./auth";
import { folderVisibilityBlocker } from "./access";
import { detectFolderCycle } from "./content-rules";

export interface FolderChange {
  parentId?: string | null;
  visibility?: string;
  /** True when the call sets the folder's rules. */
  rules?: boolean;
}

export interface FolderDenial {
  status: number;
  error: string;
}

/// Same rule as GET /api/folders: a private folder is listed only for its
/// creator, so for anyone else it reads as missing.
function hiddenFrom(folder: { visibility: string; createdBy: string }, userId: string | null): boolean {
  return AUTH_MODE !== "none" && userId !== null && folder.visibility === "private" && folder.createdBy !== userId;
}

/**
 * The one authorization check for changing a folder, shared by
 * PATCH /api/folders and MCP update_folder on both transports so they can't
 * drift apart again:
 *
 * - someone else's private folder answers "folder not found", like a
 *   missing one, and so does a parent the caller can't see
 * - stock (locked) folders can't be changed
 * - visibility: the folder's creator or an org owner/admin, and no page
 *   inside may sit below the new minimum
 * - rules: org owner/admin, the same as rules:manage on /api/rules
 * - parent: in this org, visible, no cycle
 *
 * userId null is an internal caller: visibility and role checks are skipped,
 * the locked, parent and cycle checks still apply.
 */
export async function folderUpdateDenial(
  orgId: string,
  folderId: string,
  userId: string | null,
  isManager: boolean,
  change: FolderChange
): Promise<FolderDenial | null> {
  const folder = await db.folder.findFirst({ where: { id: folderId, orgId } });
  if (!folder || hiddenFrom(folder, userId)) return { status: 404, error: `folder not found: ${folderId}` };
  if (folder.locked) return { status: 403, error: "stock folders cannot be modified" };

  const trusted = userId === null || isManager || folder.createdBy === userId;

  if (change.visibility !== undefined) {
    if (change.visibility !== "private" && change.visibility !== "org") {
      return { status: 400, error: "visibility must be 'private' or 'org'" };
    }
    if (!trusted) return { status: 403, error: "forbidden: only owner/admin or creator can change visibility" };
    const blocker = await folderVisibilityBlocker(folderId, change.visibility, userId);
    if (blocker) return { status: 400, error: blocker };
  }

  if (change.rules && userId !== null && !isManager) {
    return { status: 403, error: "forbidden: only owner/admin can set folder rules" };
  }

  if (change.parentId) {
    const parent = await db.folder.findFirst({ where: { id: change.parentId, orgId } });
    if (!parent || hiddenFrom(parent, userId)) return { status: 404, error: `parent folder not found: ${change.parentId}` };
    if (await detectFolderCycle(orgId, folderId, change.parentId)) {
      return { status: 400, error: "cannot reparent: would create a cycle" };
    }
  }

  return null;
}
