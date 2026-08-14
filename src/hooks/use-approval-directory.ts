"use client";

import { useEffect, useState } from "react";
import { basePath } from "@/lib/api-fetch";

export interface ApprovalApproverInput {
  type: "user" | "group";
  id: string;
}

export interface GroupOption {
  id: string;
  name: string;
  memberCount?: number;
}

export interface MemberOption {
  userId: string;
  email: string | null;
  role: string;
}

/**
 * Shared groups/members directory for approval-rule editors. Lazily fetches
 * `/api/groups` and `/api/members` once (mirrors the fetch approval-rule-editor.tsx
 * always did) so both the page-scope singleton editor and the Content Rules
 * tab's inline approval editor look up the same data the same way.
 */
export function useApprovalDirectory(enabled: boolean) {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    async function load() {
      const [groupsRes, membersRes] = await Promise.all([
        fetch(`${basePath}/api/groups`),
        fetch(`${basePath}/api/members`),
      ]);
      if (cancelled) return;
      if (groupsRes.ok) setGroups((await groupsRes.json()) as GroupOption[]);
      if (membersRes.ok) setMembers((await membersRes.json()) as MemberOption[]);
      setLoaded(true);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { groups, members, loaded };
}

/** Human label for an approver chip: group name, or the member's email/id. */
export function approverLabel(
  approver: ApprovalApproverInput,
  groups: GroupOption[],
  members: MemberOption[]
): string {
  if (approver.type === "group") {
    return groups.find((g) => g.id === approver.id)?.name ?? approver.id;
  }
  return members.find((m) => m.userId === approver.id)?.email ?? approver.id;
}
