"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { GroupPicklist } from "./group-picklist";
import { SettingsTable } from "@/components/settings/settings-table";

interface Member {
  id: string;
  userId: string;
  email: string | null;
  role: string;
}

interface GroupRow {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  members: { userId: string; role: string }[];
}

const ROLES = ["owner", "admin", "member", "viewer"];

interface MemberListProps {
  canManage: boolean;
  currentUserId: string;
}

export function MemberList({ canManage, currentUserId }: MemberListProps) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${basePath}/api/members`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to load members");
        return;
      }
      const data = (await res.json()) as Member[];
      setMembers(data);
    } catch {
      setError("Failed to load members");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    if (!canManage) return;
    const res = await fetch(`${basePath}/api/groups`);
    if (res.ok) {
      const data = (await res.json()) as GroupRow[];
      setGroups(data);
    }
  }, [canManage]);

  useEffect(() => {
    void (async () => {
      await load();
      await loadGroups();
    })();
  }, [load, loadGroups]);

  async function changeRole(memberId: string, role: string) {
    setBusy(memberId);
    try {
      const res = await fetch(`${basePath}/api/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, role }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error("[members] role change failed:", data.error);
      } else {
        await load();
        router.refresh();
      }
    } catch (err) {
      console.error("[members] role change error:", err);
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(memberId: string) {
    setBusy(memberId);
    try {
      const res = await fetch(`${basePath}/api/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error("[members] remove failed:", data.error);
      } else {
        await load();
        router.refresh();
      }
    } catch (err) {
      console.error("[members] remove error:", err);
    } finally {
      setBusy(null);
    }
  }

  async function toggleGroup(memberId: string, userId: string, groupId: string, add: boolean) {
    setBusy(memberId);
    try {
      const res = await fetch(`${basePath}/api/groups/members`, {
        method: add ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(add ? { groupId, userIds: [userId] } : { groupId, userId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error("[members] group toggle failed:", data.error);
      } else {
        await loadGroups();
      }
    } catch (err) {
      console.error("[members] group toggle error:", err);
    } finally {
      setBusy(null);
    }
  }

  function toggleSelected(userId: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((s) => (s.size === members.length ? new Set() : new Set(members.map((m) => m.userId))));
  }

  async function bulkAddToGroup() {
    if (!bulkGroupId || selected.size === 0) return;
    setBulkBusy(true);
    setBulkNote(null);
    try {
      const res = await fetch(`${basePath}/api/groups/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: bulkGroupId, userIds: [...selected] }),
      });
      const data = (await res.json()) as { added?: string[]; alreadyMember?: string[]; error?: string };
      if (!res.ok) {
        setBulkNote(data.error ?? "Failed to add members");
      } else {
        setBulkNote(`Added ${data.added?.length ?? 0}, already in group: ${data.alreadyMember?.length ?? 0}.`);
        setSelected(new Set());
        await loadGroups();
      }
    } catch {
      setBulkNote("Failed to add members");
    } finally {
      setBulkBusy(false);
    }
  }

  if (loading) {
    return <div className="members-loading">Loading members&hellip;</div>;
  }

  if (error) {
    return <div className="members-error">{error}</div>;
  }

  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));
  const groupsByUser = new Map<string, Set<string>>();
  for (const g of groups) {
    for (const m of g.members) {
      const set = groupsByUser.get(m.userId) ?? new Set<string>();
      set.add(g.id);
      groupsByUser.set(m.userId, set);
    }
  }

  return (
    <>
      {canManage && groups.length > 0 && selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-bar-count">{selected.size} selected</span>
          <span className="bulk-bar-actions">
            <select
              className="bulk-bar-select"
              value={bulkGroupId}
              onChange={(e) => setBulkGroupId(e.target.value)}
            >
              <option value="">Choose a group&hellip;</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button
              className="bulk-bar-btn"
              onClick={bulkAddToGroup}
              disabled={bulkBusy || !bulkGroupId}
            >
              {bulkBusy ? "Adding…" : "Add to group"}
            </button>
            {bulkNote && <span className="bulk-bar-note">{bulkNote}</span>}
          </span>
          <button className="bulk-bar-clear" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      <SettingsTable
        head={
          <>
            {canManage && groups.length > 0 && (
              <th className="dash-th dash-th-check">
                <input
                  type="checkbox"
                  checked={selected.size === members.length && members.length > 0}
                  onChange={toggleSelectAll}
                  aria-label="Select all members"
                />
              </th>
            )}
            <th className="dash-th dash-th-title">Member</th>
            <th className="dash-th">Role</th>
            {canManage && <th className="dash-th">Groups</th>}
            {canManage && <th className="dash-th dash-th-right">Actions</th>}
          </>
        }
      >
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            const isBusy = busy === m.id;
            return (
              <tr key={m.id} className="dash-row">
                {canManage && groups.length > 0 && (
                  <td className="dash-td dash-td-check">
                    <input
                      type="checkbox"
                      checked={selected.has(m.userId)}
                      onChange={() => toggleSelected(m.userId)}
                      aria-label={`Select ${m.userId}`}
                    />
                  </td>
                )}
                <td className="dash-td dash-td-title">
                  <span className="members-email">
                    {m.email ?? m.userId.slice(0, 16) + "…"}
                  </span>
                  {isSelf && <span className="members-self-badge">you</span>}
                </td>
                <td className="dash-td">
                  {canManage ? (
                    <select
                      className="members-role-select"
                      value={m.role}
                      disabled={isBusy}
                      onChange={(e) => changeRole(m.id, e.target.value)}
                      aria-label="Change role"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`members-role-badge members-role-badge--${m.role}`}>
                      {m.role}
                    </span>
                  )}
                </td>
                {canManage && (
                  <td className="dash-td">
                    <GroupPicklist
                      memberGroupIds={groupsByUser.get(m.userId) ?? new Set()}
                      allGroups={groupOptions}
                      onToggle={(groupId, add) => toggleGroup(m.id, m.userId, groupId, add)}
                      busy={isBusy}
                    />
                  </td>
                )}
                {canManage && (
                  <td className="dash-td dash-td-right">
                    {!isSelf && (
                      <span className="stg-row-actions">
                        <button
                          className="members-remove-btn"
                          onClick={() => removeMember(m.id)}
                          disabled={isBusy}
                        >
                          {isBusy ? "..." : "Remove"}
                        </button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
      </SettingsTable>
    </>
  );
}
