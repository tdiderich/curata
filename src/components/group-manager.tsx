"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { ConfirmDeleteModal } from "./confirm-delete-modal";
import { SettingsTable } from "@/components/settings/settings-table";

interface GroupMemberRow {
  userId: string;
  role: string;
}

interface GroupRow {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  members: GroupMemberRow[];
}

/**
 * Groups settings tab: create/rename/delete groups, expand a group to view
 * membership, remove a member, or transfer the group-level "owner" role.
 * The org-level group:manage capability gates all mutations here — the
 * per-group "owner" role is informational only in v1 (no gating tied to it
 * yet; folder approval groups are a later feature).
 */
export function GroupManager({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<GroupRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${basePath}/api/groups`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to load groups");
        return;
      }
      setGroups((await res.json()) as GroupRow[]);
    } catch {
      setError("Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function createGroup() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${basePath}/api/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to create group");
      } else {
        setNewName("");
        setError(null);
        await load();
        router.refresh();
      }
    } finally {
      setCreating(false);
    }
  }

  async function saveRename(id: string) {
    if (!renameValue.trim()) return;
    setBusy(id);
    try {
      const res = await fetch(`${basePath}/api/groups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: id, name: renameValue.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to rename group");
      } else {
        setError(null);
        setRenamingId(null);
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setBusy(id);
    try {
      const res = await fetch(`${basePath}/api/groups`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: id }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to delete group");
      } else {
        setError(null);
        await load();
        router.refresh();
      }
    } finally {
      setBusy(null);
      setPendingDelete(null);
    }
  }

  async function removeMember(groupId: string, userId: string) {
    const key = `${groupId}:${userId}`;
    setBusy(key);
    try {
      const res = await fetch(`${basePath}/api/groups/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, userId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to remove member");
      } else {
        setError(null);
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  async function setRole(groupId: string, userId: string, role: "member" | "owner") {
    const key = `${groupId}:${userId}`;
    setBusy(key);
    try {
      const res = await fetch(`${basePath}/api/groups/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, userId, role }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to update role");
      } else {
        setError(null);
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="members-loading">Loading groups&hellip;</div>;
  }

  const colSpan = canManage ? 3 : 2;

  return (
    <div className="group-manager">
      {error && <div className="members-error">{error}</div>}

      {canManage && (
        <div className="key-create-form">
          <input
            className="pe-input key-create-name"
            type="text"
            placeholder="Group name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createGroup();
            }}
          />
          <button
            className="agent-btn-primary"
            onClick={createGroup}
            disabled={creating || !newName.trim()}
          >
            {creating ? "Creating…" : "Create group"}
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="dash-empty">No groups yet.</div>
      ) : (
        <SettingsTable
          head={
            <>
              <th className="dash-th dash-th-title">Group</th>
              <th className="dash-th">Members</th>
              {canManage && <th className="dash-th dash-th-right">Actions</th>}
            </>
          }
        >
            {groups.map((g) => (
              <Fragment key={g.id}>
                <tr className="dash-row">
                  <td className="dash-td dash-td-title">
                    {renamingId === g.id ? (
                      <span className="group-rename-form">
                        <input
                          className="pe-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(g.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          autoFocus
                        />
                        <button
                          className="agent-btn-primary"
                          onClick={() => saveRename(g.id)}
                          disabled={busy === g.id}
                        >
                          Save
                        </button>
                        <button className="cleanup-btn" onClick={() => setRenamingId(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="group-expand-btn"
                        onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                      >
                        <span aria-hidden>{expanded === g.id ? "▾" : "▸"}</span> {g.name}
                      </button>
                    )}
                  </td>
                  <td className="dash-td dash-td-muted">{g.memberCount}</td>
                  {canManage && (
                    <td className="dash-td dash-td-right">
                      <span className="stg-row-actions">
                        <button
                          className="members-remove-btn"
                          onClick={() => {
                            setRenamingId(g.id);
                            setRenameValue(g.name);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="members-remove-btn"
                          onClick={() => setPendingDelete(g)}
                          disabled={busy === g.id}
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
                {expanded === g.id && (
                  <tr className="dash-row dash-row--nested">
                    <td className="dash-td" colSpan={colSpan}>
                      {g.members.length === 0 ? (
                        <span className="org-tags-empty">No members yet.</span>
                      ) : (
                        <ul className="group-member-list">
                          {g.members.map((m) => {
                            const key = `${g.id}:${m.userId}`;
                            return (
                              <li key={m.userId} className="group-member-row">
                                <span className="members-email">{m.userId}</span>
                                <span
                                  className={`members-role-badge members-role-badge--${m.role === "owner" ? "owner" : "member"}`}
                                >
                                  {m.role}
                                </span>
                                {canManage && (
                                  <span className="group-member-actions">
                                    <button
                                      className="members-remove-btn"
                                      onClick={() => setRole(g.id, m.userId, m.role === "owner" ? "member" : "owner")}
                                      disabled={busy === key}
                                    >
                                      {m.role === "owner" ? "Remove owner" : "Make owner"}
                                    </button>
                                    <button
                                      className="members-remove-btn"
                                      onClick={() => removeMember(g.id, m.userId)}
                                      disabled={busy === key}
                                    >
                                      Remove
                                    </button>
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
        </SettingsTable>
      )}

      {pendingDelete && (
        <ConfirmDeleteModal
          title={<>Delete group &ldquo;{pendingDelete.name}&rdquo;?</>}
          confirmButtonLabel="Delete group"
          busyLabel="Deleting…"
          busy={busy === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        >
          This removes {pendingDelete.memberCount} membership{pendingDelete.memberCount === 1 ? "" : "s"}. This
          cannot be undone.
        </ConfirmDeleteModal>
      )}
    </div>
  );
}
