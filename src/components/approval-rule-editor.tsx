"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { ChipInput, type ChipInputChip, type ChipInputOption } from "@/components/settings/chip-input";
import { FormRow } from "@/components/settings/form-row";
import { useApprovalDirectory, type ApprovalApproverInput } from "@/hooks/use-approval-directory";

export type { ApprovalApproverInput };

interface ApprovalRuleEditorProps {
  scopeParam: string;
  /** The page-level rule as stored (not the cascaded/effective one) — null when this scope has no override. */
  initialApprovers: ApprovalApproverInput[] | null;
  /** Human-readable description of whichever scope is currently effective (page, folder, or global), for context. */
  effectiveNote: string | null;
  canManage: boolean;
  /** Effective trust mode for this scope — "auto" means latest is trusted, "locked" means explicit approval required. */
  trustMode?: "auto" | "locked";
  /** Whether a trust rule exists at THIS scope (not inherited). */
  hasTrustRuleAtScope?: boolean;
  /** Render in settings-page layout (FormRow fields) instead of inline panel layout. */
  settingsLayout?: boolean;
  /** Trust status label for settings layout. */
  trustStatusLabel?: string;
}

function splitApproverId(prefixed: string): ApprovalApproverInput {
  if (prefixed.startsWith("group:")) return { type: "group", id: prefixed.slice(6) };
  return { type: "user", id: prefixed.slice(5) };
}

/**
 * Sets the page-scope approval rule: a singleton rule (id "approval") whose
 * approvers are a mix of individual org members and whole groups. Only
 * page scope gets an editor for now — folder/global approval rules are set
 * either via the Content Rules settings tab (which embeds the same
 * groups/members directory + save/clear logic) or the set_rules MCP tool.
 */
export function ApprovalRuleEditor({ scopeParam, initialApprovers, effectiveNote, canManage, trustMode: initialTrustMode = "auto", hasTrustRuleAtScope = false, settingsLayout = false, trustStatusLabel }: ApprovalRuleEditorProps) {
  const router = useRouter();
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(
    new Set((initialApprovers ?? []).filter((a) => a.type === "group").map((a) => a.id))
  );
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(
    new Set((initialApprovers ?? []).filter((a) => a.type === "user").map((a) => a.id))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localTrustMode, setLocalTrustMode] = useState<"auto" | "locked">(initialTrustMode);
  const hasRule = initialApprovers !== null && initialApprovers.length > 0;

  const { groups, members, loaded } = useApprovalDirectory(canManage);

  function addApprover(prefixedId: string) {
    const approver = splitApproverId(prefixedId);
    if (approver.type === "group") setSelectedGroups((prev) => new Set(prev).add(approver.id));
    else setSelectedUsers((prev) => new Set(prev).add(approver.id));
  }

  function removeApprover(prefixedId: string) {
    const approver = splitApproverId(prefixedId);
    if (approver.type === "group") {
      setSelectedGroups((prev) => {
        const next = new Set(prev);
        next.delete(approver.id);
        return next;
      });
    } else {
      setSelectedUsers((prev) => {
        const next = new Set(prev);
        next.delete(approver.id);
        return next;
      });
    }
  }

  async function saveTrustRule(mode: "locked" | "remove") {
    const method = mode === "remove" ? "DELETE" : hasTrustRuleAtScope ? "PUT" : "POST";
    const url = mode === "remove"
      ? `${basePath}/api/rules?${scopeParam}&ruleId=trust`
      : `${basePath}/api/rules?${scopeParam}`;
    const res = await fetch(url, {
      method,
      ...(mode !== "remove" ? {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "trust", kind: "trust", mode: "locked" }),
      } : {}),
    });
    if (!res.ok && res.status !== 404 && res.status !== 409) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || "Failed to update trust mode.");
    }
  }

  async function toggleTrustMode() {
    const newMode = localTrustMode === "locked" ? "auto" : "locked";
    setBusy(true);
    setError(null);
    try {
      await saveTrustRule(newMode === "locked" ? "locked" : "remove");
      setLocalTrustMode(newMode);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update trust mode.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const approvers: ApprovalApproverInput[] = [
      ...[...selectedGroups].map((id) => ({ type: "group" as const, id })),
      ...[...selectedUsers].map((id) => ({ type: "user" as const, id })),
    ];
    if (approvers.length === 0) {
      await clear();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const method = hasRule ? "PUT" : "POST";
      const res = await fetch(`${basePath}/api/rules?${scopeParam}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "approval", kind: "approval", approvers }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error || "Failed to save approval rule.");
        return;
      }
      if (localTrustMode !== "locked") {
        try { await saveTrustRule("locked"); } catch { /* best-effort auto-lock */ }
        setLocalTrustMode("locked");
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/rules?${scopeParam}&ruleId=approval`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        // A 404 just means there was nothing to clear yet — not an error worth surfacing.
        if (res.status !== 404) {
          setError(json.error || "Failed to clear approval rule.");
          return;
        }
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const chips: ChipInputChip[] = [
    ...[...selectedGroups].map((id) => ({ id: `group:${id}`, label: groups.find((g) => g.id === id)?.name ?? id })),
    ...[...selectedUsers].map((id) => ({ id: `user:${id}`, label: members.find((m) => m.userId === id)?.email ?? id })),
  ];
  const options: ChipInputOption[] = [
    ...groups.map((g) => ({
      id: `group:${g.id}`,
      label: g.name,
      sublabel: `group${g.memberCount != null ? ` · ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}` : ""}`,
    })),
    ...members.map((m) => ({ id: `user:${m.userId}`, label: m.email ?? m.userId, sublabel: "member" })),
  ];

  if (settingsLayout) {
    return (
      <div className="cr-editor">
        {error && <div className="cr-error">{error}</div>}
        <FormRow label="Trust mode" hint="Auto-trust publishes every save immediately. Locked requires explicit approval.">
          <div className="stg-seg">
            <button
              className={`stg-seg-btn${localTrustMode === "auto" ? " stg-seg-btn--on" : ""}`}
              disabled={!canManage || busy}
              onClick={() => localTrustMode !== "auto" && toggleTrustMode()}
            >
              Auto
            </button>
            <button
              className={`stg-seg-btn${localTrustMode === "locked" ? " stg-seg-btn--on" : ""}`}
              disabled={!canManage || busy}
              onClick={() => localTrustMode !== "locked" && toggleTrustMode()}
            >
              Locked
            </button>
          </div>
        </FormRow>
        {trustStatusLabel && (
          <FormRow label="Status">
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{trustStatusLabel}</span>
          </FormRow>
        )}
        {localTrustMode === "locked" && (
          <FormRow label="Approvers" hint={effectiveNote ?? "Restrict who can approve new versions."}>
            {!canManage ? (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {effectiveNote || "No approval restriction."}
              </span>
            ) : !loaded ? (
              <div className="vh-empty">Loading&hellip;</div>
            ) : groups.length === 0 && members.length === 0 ? (
              <div className="cr-empty">No groups or members to restrict approval to yet.</div>
            ) : (
              <>
                <ChipInput
                  chips={chips}
                  onRemove={removeApprover}
                  options={options}
                  onAdd={addApprover}
                  placeholder="Add a group or person..."
                  disabled={busy}
                />
                <div className="cr-edit-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn--primary" onClick={save} disabled={busy}>
                    {busy ? "Saving..." : "Save approvers"}
                  </button>
                  {hasRule && (
                    <button className="btn btn--ghost" onClick={clear} disabled={busy}>
                      Remove restriction
                    </button>
                  )}
                </div>
              </>
            )}
          </FormRow>
        )}
      </div>
    );
  }

  if (!canManage) {
    return effectiveNote ? (
      <div className="rules-panel-row" style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 20px" }}>
        {effectiveNote}
      </div>
    ) : (
      <div className="rules-panel-row" style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 20px" }}>
        No approval restriction - anyone who can edit this page can approve.
      </div>
    );
  }

  return (
    <div className="cr-editor" style={{ padding: "4px 20px 12px" }}>
      {error && <div className="cr-error">{error}</div>}
      {effectiveNote && <div className="cr-field-hint" style={{ marginBottom: 6 }}>{effectiveNote}</div>}
      {!loaded ? (
        <div className="vh-empty">Loading&hellip;</div>
      ) : (
        <>
          {groups.length === 0 && members.length === 0 ? (
            <div className="cr-empty">No groups or members to restrict approval to yet.</div>
          ) : (
            <ChipInput
              chips={chips}
              onRemove={removeApprover}
              options={options}
              onAdd={addApprover}
              placeholder="Add a group or person…"
              disabled={busy}
            />
          )}
          <div className="cr-edit-actions" style={{ marginTop: 8 }}>
            <button className="btn btn--primary" onClick={save} disabled={busy}>
              {busy ? "Saving..." : "Save approvers"}
            </button>
            {hasRule && (
              <button className="btn btn--ghost" onClick={clear} disabled={busy}>
                Remove restriction
              </button>
            )}
          </div>
          <div className="cr-trust-toggle" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 13, color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={localTrustMode === "locked"}
                onChange={toggleTrustMode}
                disabled={busy}
                style={{ accentColor: "var(--accent)" }}
              />
              Require approval before publishing
            </label>
            {localTrustMode === "locked" && (
              <span style={{ fontSize: 12, color: "var(--text-muted)", opacity: 0.7 }}>
                Viewers see the last approved version
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
