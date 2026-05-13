"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";

interface Member {
  id: string;
  userId: string;
  email: string | null;
  role: string;
}

const ROLES = ["owner", "admin", "member", "viewer"];

interface MemberListProps {
  canManage: boolean;
  currentUserId: string;
}

export function MemberList({ canManage, currentUserId }: MemberListProps) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
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
  }

  useEffect(() => {
    load();
  }, []);

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

  if (loading) {
    return <div className="members-loading">Loading members&hellip;</div>;
  }

  if (error) {
    return <div className="members-error">{error}</div>;
  }

  return (
    <table className="dash-table">
      <thead>
        <tr>
          <th className="dash-th dash-th-title">Member</th>
          <th className="dash-th">Role</th>
          {canManage && <th className="dash-th dash-th-right">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {members.map((m) => {
          const isSelf = m.userId === currentUserId;
          const isBusy = busy === m.id;
          return (
            <tr key={m.id} className="dash-row">
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
                <td className="dash-td dash-td-right">
                  {!isSelf && (
                    <button
                      className="members-remove-btn"
                      onClick={() => removeMember(m.id)}
                      disabled={isBusy}
                    >
                      {isBusy ? "..." : "Remove"}
                    </button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
