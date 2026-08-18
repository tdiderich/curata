"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import { SettingsTable } from "@/components/settings/settings-table";
import { StatusBadge, type StatusBadgeTone } from "@/components/settings/status-badge";
import { FormRow } from "@/components/settings/form-row";
import { SegmentedControl } from "@/components/settings/segmented-control";
import { ChipInput, type ChipInputChip, type ChipInputOption } from "@/components/settings/chip-input";
import { TeamChip } from "@/components/settings/team-chip";
import {
  useApprovalDirectory,
  approverLabel,
  type ApprovalApproverInput,
} from "@/hooks/use-approval-directory";

interface ContentRule {
  id: string;
  text: string;
  mode: "warn" | "block";
  patterns?: string[];
}

/** Client-side mirror of ApprovalRule from @/lib/approval — kept local so this
 * "use client" component doesn't pull the server-only db import into the bundle. */
interface ApprovalRuleData {
  id: string;
  kind: "approval";
  approvers: ApprovalApproverInput[];
}

/** Client-side mirror of RequiredComponentsRule from @/lib/required-components. */
interface RequiredComponentsRuleData {
  id: string;
  kind: "required-components";
  pageType: string;
  requiredComponentIds: string[];
  requiredFields?: string[];
  requireConcepts?: boolean;
}

interface InheritedRule {
  id: string;
  text: string;
  mode: string;
  scope: string;
  patterns?: string[];
}

interface ContentRulesEditorProps {
  scopeParam: string;
  initialRules: ContentRule[];
  canManage: boolean;
  /** Shows a small "Team" chip next to the approvers picker. Pay-to-play
   * signal only — approval groups still work the same either way. */
  limitedPlan?: boolean;
  /** Read-only rules inherited from folder/org scope, rendered at the top of the table. */
  inheritedRules?: InheritedRule[];
  /** Trust mode for page-level settings: shows segmented control above the rules table. */
  trustMode?: "auto" | "locked";
  /** Whether a trust rule exists at THIS scope (not inherited). */
  hasTrustRuleAtScope?: boolean;
  /** Status label for trust mode display. */
  trustStatusLabel?: string;
}

type Enforcement = "block" | "review" | "guidance";
type EditingKind = "content" | "approval" | "required-components" | null;

function enforcementOf(rule: ContentRule): Enforcement {
  if (!rule.patterns || rule.patterns.length === 0) return "guidance";
  return rule.mode === "block" ? "block" : "review";
}

const ENFORCEMENT_BADGE: Record<Enforcement, { tone: StatusBadgeTone; label: string }> = {
  block: { tone: "block", label: "Block" },
  review: { tone: "review", label: "Review" },
  guidance: { tone: "guidance", label: "Guidance" },
};

const ENFORCEMENT_HINT: Record<Enforcement, string> = {
  block: "Block: saves with matches are rejected and the error cites this rule.",
  review: "Review: matches are flagged in write results but the save still succeeds.",
  guidance: "Guidance: shown to agents on read, not enforced on save (no patterns).",
};

const KIND_HINT: Record<"content" | "approval" | "required-components", string> = {
  content: "A content rule checks page saves against regex patterns and an enforcement level.",
  approval: "Approval: changes to matching pages only serve as trusted after an approver signs off.",
  "required-components": "Required shape: pages that declare a matching pageType must keep a fixed set of component ids (and optionally a concept tag) on every save.",
};

function splitApproverId(prefixed: string): ApprovalApproverInput {
  if (prefixed.startsWith("group:")) return { type: "group", id: prefixed.slice(6) };
  return { type: "user", id: prefixed.slice(5) };
}

export function ContentRulesEditor({ scopeParam, initialRules, canManage, limitedPlan, inheritedRules, trustMode: initialTrustMode, hasTrustRuleAtScope = false, trustStatusLabel }: ContentRulesEditorProps) {
  const router = useRouter();
  const [rules, setRules] = useState<ContentRule[]>(initialRules);
  const [approvalRule, setApprovalRule] = useState<ApprovalRuleData | null>(null);
  const [rcRules, setRcRules] = useState<RequiredComponentsRuleData[]>([]);

  const [editingKind, setEditingKind] = useState<EditingKind>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formText, setFormText] = useState("");
  const [formMode, setFormMode] = useState<"warn" | "block">("warn");
  const [formPatterns, setFormPatterns] = useState<string[]>([]);

  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  const [formPageType, setFormPageType] = useState("");
  const [formRequiredIds, setFormRequiredIds] = useState<string[]>([]);
  const [formRequiredFields, setFormRequiredFields] = useState<string[]>([]);
  const [formRequireConcepts, setFormRequireConcepts] = useState(true);

  const [localTrustMode, setLocalTrustMode] = useState<"auto" | "locked">(initialTrustMode ?? "auto");
  const showTrustControls = initialTrustMode !== undefined;

  const { groups, members } = useApprovalDirectory(canManage);

  // Approval-kind and required-components-kind rules ride the same rules
  // array but are excluded from the server-computed `initialRules` prop
  // (globalRules in settings/page.tsx only keeps `text`-shaped rules), so
  // fetch the full scope once to pick them up.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    async function load() {
      const res = await fetch(`${basePath}/api/rules?${scopeParam}`);
      if (cancelled || !res.ok) return;
      const data = (await res.json()) as { rules: Array<ContentRule | ApprovalRuleData | RequiredComponentsRuleData> };
      const approval = data.rules.find((r): r is ApprovalRuleData => "kind" in r && r.kind === "approval");
      setApprovalRule(approval ?? null);
      const rc = data.rules.filter((r): r is RequiredComponentsRuleData => "kind" in r && r.kind === "required-components");
      setRcRules(rc);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [scopeParam, canManage]);

  function resetContentForm() {
    setFormText("");
    setFormMode("warn");
    setFormPatterns([]);
  }

  function resetApprovalForm() {
    setSelectedGroups(new Set());
    setSelectedUsers(new Set());
  }

  function resetRcForm() {
    setFormPageType("");
    setFormRequiredIds([]);
    setFormRequiredFields([]);
    setFormRequireConcepts(true);
  }

  function cancelEdit() {
    setEditingKind(null);
    setEditingId(null);
    resetContentForm();
    resetApprovalForm();
    resetRcForm();
  }

  function startEditContent(rule: ContentRule) {
    setEditingKind("content");
    setEditingId(rule.id);
    setFormText(rule.text);
    setFormMode(rule.mode);
    setFormPatterns(rule.patterns && rule.patterns.length > 0 ? rule.patterns : []);
  }

  function startEditApproval() {
    setEditingKind("approval");
    setEditingId(approvalRule?.id ?? null);
    setSelectedGroups(new Set((approvalRule?.approvers ?? []).filter((a) => a.type === "group").map((a) => a.id)));
    setSelectedUsers(new Set((approvalRule?.approvers ?? []).filter((a) => a.type === "user").map((a) => a.id)));
  }

  function startEditRc(rule: RequiredComponentsRuleData) {
    setEditingKind("required-components");
    setEditingId(rule.id);
    setFormPageType(rule.pageType);
    setFormRequiredIds(rule.requiredComponentIds.length > 0 ? rule.requiredComponentIds : [""]);
    setFormRequiredFields(rule.requiredFields ?? []);
    setFormRequireConcepts(rule.requireConcepts ?? false);
  }

  /** "Add rule" entry point — always opens a blank content draft; the kind
   * control inside the draft lets the user switch to Approval or Required shape before saving. */
  function openNewDraft() {
    setEditingKind("content");
    setEditingId(null);
    setFormText("");
    setFormMode("warn");
    setFormPatterns([""]);
    resetApprovalForm();
    resetRcForm();
  }

  function enforcementSegValue(): Enforcement {
    return formPatterns.map((p) => p.trim()).filter(Boolean).length === 0
      ? "guidance"
      : formMode === "block"
      ? "block"
      : "review";
  }

  function handleEnforcementChange(next: Enforcement) {
    if (next === "guidance") {
      setFormPatterns([]);
      setFormMode("warn");
    } else {
      setFormMode(next === "block" ? "block" : "warn");
    }
  }

  function handleKindSwitch(next: "content" | "approval" | "required-components") {
    // Only reachable while drafting a brand-new rule — kind is locked once
    // a rule is persisted (existing rows never show this control at all).
    if (editingId !== null) return;
    if (next === "content") {
      setEditingKind("content");
      resetApprovalForm();
      resetRcForm();
      setFormPatterns((prev) => (prev.length > 0 ? prev : [""]));
    } else if (next === "approval") {
      setEditingKind("approval");
      resetContentForm();
      resetRcForm();
    } else {
      setEditingKind("required-components");
      resetContentForm();
      resetApprovalForm();
      setFormRequiredIds((prev) => (prev.length > 0 ? prev : [""]));
    }
  }

  async function toggleTrustMode() {
    const newMode = localTrustMode === "locked" ? "auto" : "locked";
    setBusy(true);
    setError(null);
    try {
      if (newMode === "locked") {
        const method = hasTrustRuleAtScope ? "PUT" : "POST";
        const res = await fetch(`${basePath}/api/rules?${scopeParam}`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "trust", kind: "trust", mode: "locked" }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error || "Failed to update trust mode.");
        }
      } else {
        await fetch(`${basePath}/api/rules?${scopeParam}&ruleId=trust`, { method: "DELETE" });
      }
      setLocalTrustMode(newMode);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update trust mode.");
    } finally {
      setBusy(false);
    }
  }

  async function saveContentRule() {
    const text = formText.trim();
    if (!text) return;
    const patterns = formPatterns.map((p) => p.trim()).filter(Boolean);
    setBusy(true);
    setError(null);
    const mode = patterns.length > 0 ? formMode : "warn";
    const body: Record<string, unknown> = { text, mode };
    if (patterns.length > 0) body.patterns = patterns;

    try {
      if (editingId) {
        body.id = editingId;
        const res = await fetch(`${basePath}/api/rules?${scopeParam}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          setError(json.error || "Failed to update rule.");
          return;
        }
        const data = (await res.json()) as { rule: ContentRule };
        setRules((prev) => prev.map((r) => (r.id === editingId ? data.rule : r)));
      } else {
        const res = await fetch(`${basePath}/api/rules?${scopeParam}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          setError(json.error || "Failed to add rule.");
          return;
        }
        const data = (await res.json()) as { rule: ContentRule };
        setRules((prev) => [...prev, data.rule]);
      }
      cancelEdit();
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function saveApprovalRule() {
    const approvers: ApprovalApproverInput[] = [
      ...[...selectedGroups].map((id) => ({ type: "group" as const, id })),
      ...[...selectedUsers].map((id) => ({ type: "user" as const, id })),
    ];
    setBusy(true);
    setError(null);
    try {
      if (approvers.length === 0) {
        const res = await fetch(`${basePath}/api/rules?${scopeParam}&ruleId=approval`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setError(json.error || "Failed to clear approval rule.");
          return;
        }
        setApprovalRule(null);
      } else {
        const method = approvalRule ? "PUT" : "POST";
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
        const data = (await res.json()) as { rule: ApprovalRuleData };
        setApprovalRule(data.rule);
      }
      cancelEdit();
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRcRule() {
    const pageType = formPageType.trim();
    if (!pageType) return;
    const requiredComponentIds = formRequiredIds.map((id) => id.trim()).filter(Boolean);
    const requiredFields = formRequiredFields.map((f) => f.trim()).filter(Boolean);
    if (requiredComponentIds.length === 0 && requiredFields.length === 0 && !formRequireConcepts) return;

    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      kind: "required-components",
      pageType,
      requiredComponentIds,
      ...(requiredFields.length > 0 ? { requiredFields } : {}),
      ...(formRequireConcepts ? { requireConcepts: true } : {}),
    };

    try {
      if (editingId) {
        body.id = editingId;
        const res = await fetch(`${basePath}/api/rules?${scopeParam}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setError(json.error || "Failed to update rule.");
          return;
        }
        const data = (await res.json()) as { rule: RequiredComponentsRuleData };
        setRcRules((prev) => prev.map((r) => (r.id === editingId ? data.rule : r)));
      } else {
        const res = await fetch(`${basePath}/api/rules?${scopeParam}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setError(json.error || "Failed to add rule.");
          return;
        }
        const data = (await res.json()) as { rule: RequiredComponentsRuleData };
        setRcRules((prev) => [...prev, data.rule]);
      }
      cancelEdit();
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(ruleId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/api/rules?${scopeParam}&ruleId=${ruleId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(json.error || "Failed to delete rule.");
        return;
      }
      if (ruleId === "approval") {
        setApprovalRule(null);
      } else if (rcRules.some((r) => r.id === ruleId)) {
        setRcRules((prev) => prev.filter((r) => r.id !== ruleId));
      } else {
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
      }
      if (editingId === ruleId) cancelEdit();
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

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

  const approverChips: ChipInputChip[] = [
    ...[...selectedGroups].map((id) => ({ id: `group:${id}`, label: groups.find((g) => g.id === id)?.name ?? id })),
    ...[...selectedUsers].map((id) => ({ id: `user:${id}`, label: members.find((m) => m.userId === id)?.email ?? id })),
  ];
  const approverOptions: ChipInputOption[] = [
    ...groups.map((g) => ({
      id: `group:${g.id}`,
      label: g.name,
      sublabel: `group${g.memberCount != null ? ` · ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}` : ""}`,
    })),
    ...members.map((m) => ({ id: `user:${m.userId}`, label: m.email ?? m.userId, sublabel: "member" })),
  ];

  /** Shared field set for both the "edit an existing content rule" row and the new-draft row. */
  function contentFields() {
    return (
      <>
        <FormRow label="Rule" hint="Shown to agents in write errors and to humans here. Write it as an instruction.">
          <textarea
            className="stg-textarea"
            rows={2}
            value={formText}
            onChange={(e) => setFormText(e.target.value)}
          />
        </FormRow>
        <FormRow label="Regex patterns" hint="Content matching any pattern triggers this rule on save.">
          {formPatterns.map((p, idx) => (
            <div className="stg-pat-row" key={idx}>
              <input
                className="stg-input"
                value={p}
                onChange={(e) => setFormPatterns((prev) => prev.map((v, i2) => (i2 === idx ? e.target.value : v)))}
              />
              <button
                type="button"
                className="stg-icon-btn"
                title="Remove pattern"
                onClick={() => setFormPatterns((prev) => prev.filter((_, i2) => i2 !== idx))}
              >
                &times;
              </button>
            </div>
          ))}
          <button type="button" className="stg-addpat" onClick={() => setFormPatterns((prev) => [...prev, ""])}>
            + Add pattern
          </button>
        </FormRow>
        <FormRow label="Enforcement" hint={ENFORCEMENT_HINT[enforcementSegValue()]}>
          <SegmentedControl<Enforcement>
            value={enforcementSegValue()}
            onChange={handleEnforcementChange}
            options={[
              { value: "block", label: "Block" },
              { value: "review", label: "Review" },
              { value: "guidance", label: "Guidance" },
            ]}
          />
        </FormRow>
      </>
    );
  }

  /** Shared field set for both the "edit the existing approval rule" row and the new-draft row. */
  function approvalFields() {
    return (
      <FormRow
        label={<>Approvers{limitedPlan && <TeamChip />}</>}
        hint="Org owners and admins can always approve. Everyone else needs to be listed here or be in a listed group."
      >
        <ChipInput
          chips={approverChips}
          onRemove={removeApprover}
          options={approverOptions}
          onAdd={addApprover}
          placeholder="Add a group or person…"
          disabled={busy}
        />
      </FormRow>
    );
  }

  /** Freeform list editor (add/remove text rows) shared by the required
   * component ids and required fields inputs — same interaction as the
   * content rule's "Regex patterns" list above. */
  function stringListEditor(values: string[], setValues: (fn: (prev: string[]) => string[]) => void, addLabel: string) {
    return (
      <>
        {values.map((v, idx) => (
          <div className="stg-pat-row" key={idx}>
            <input
              className="stg-input"
              value={v}
              onChange={(e) => setValues((prev) => prev.map((x, i2) => (i2 === idx ? e.target.value : x)))}
            />
            <button
              type="button"
              className="stg-icon-btn"
              title="Remove"
              onClick={() => setValues((prev) => prev.filter((_, i2) => i2 !== idx))}
            >
              &times;
            </button>
          </div>
        ))}
        <button type="button" className="stg-addpat" onClick={() => setValues((prev) => [...prev, ""])}>
          {addLabel}
        </button>
      </>
    );
  }

  /** Shared field set for both the "edit an existing required-components rule" row and the new-draft row. */
  function rcFields() {
    return (
      <>
        <FormRow label="Page type" hint="Matches the page's own top-level pageType field — only pages that declare this type are checked.">
          <input
            className="stg-input"
            value={formPageType}
            onChange={(e) => setFormPageType(e.target.value)}
            placeholder="captured-qa"
          />
        </FormRow>
        <FormRow label="Required component ids" hint="Component ids (see get_component_reference) that must exist somewhere on the page.">
          {stringListEditor(formRequiredIds, setFormRequiredIds, "+ Add component id")}
        </FormRow>
        <FormRow label="Required fields" hint="Top-level page fields (title, subtitle, eyebrow…) that must be present and non-empty. Optional.">
          {stringListEditor(formRequiredFields, setFormRequiredFields, "+ Add field")}
        </FormRow>
        <FormRow label="Concept tag" hint="If required, the page must carry at least one concept tag.">
          <SegmentedControl<"required" | "optional">
            value={formRequireConcepts ? "required" : "optional"}
            onChange={(v) => setFormRequireConcepts(v === "required")}
            options={[
              { value: "required", label: "Required" },
              { value: "optional", label: "Optional" },
            ]}
          />
        </FormRow>
      </>
    );
  }

  const isNewDraft = editingKind !== null && editingId === null;
  const showApprovalRow = !!approvalRule;
  const hasInherited = inheritedRules && inheritedRules.length > 0;
  const hasAnyRows = rules.length > 0 || showApprovalRow || rcRules.length > 0 || isNewDraft || !!hasInherited;
  const totalCols = (hasInherited ? 4 : 3) + (canManage ? 1 : 0);

  return (
    <div className="cr-editor">
      {error && <div className="cr-error">{error}</div>}

      {showTrustControls && (
        <FormRow label="Trust mode" hint={trustStatusLabel}>
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
      )}

      <SettingsTable
        head={
          <>
            <th className="dash-th dash-th-title" style={{ width: hasInherited ? "44%" : "52%" }}>Rule</th>
            <th className="dash-th">Enforcement</th>
            {hasInherited && <th className="dash-th">Scope</th>}
            <th className="dash-th">Patterns</th>
            {canManage && <th className="dash-th stg-th-right">&nbsp;</th>}
          </>
        }
        empty={!hasAnyRows ? "No content rules configured." : undefined}
      >
        {hasInherited && inheritedRules!.map((rule) => {
          const asContent = { ...rule, mode: rule.mode as "warn" | "block" };
          const badge = ENFORCEMENT_BADGE[enforcementOf(asContent)] ?? { tone: "guidance" as StatusBadgeTone, label: rule.mode };
          return (
            <tr key={`inherited-${rule.id}`} className="dash-row" style={{ opacity: 0.65 }}>
              <td className="dash-td dash-td-title">{rule.text}</td>
              <td className="dash-td">
                <StatusBadge tone={badge.tone} label={badge.label} />
              </td>
              <td className="dash-td">
                <a href="/settings?tab=content-rules" className="stg-pcount" style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>
                  {rule.scope}
                </a>
              </td>
              <td className="dash-td">
                {rule.patterns && rule.patterns.length > 0 ? (
                  <span className="stg-pcount">
                    {rule.patterns.length} pattern{rule.patterns.length !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <span className="stg-pcount">&mdash;</span>
                )}
              </td>
              {canManage && <td className="dash-td stg-td-right" />}
            </tr>
          );
        })}
        {rules.map((rule) => {
          const badge = ENFORCEMENT_BADGE[enforcementOf(rule)];
          const isEditing = editingKind === "content" && editingId === rule.id;
          return (
            <Fragment key={rule.id}>
              <tr className="dash-row">
                <td className="dash-td dash-td-title">{rule.text}</td>
                <td className="dash-td">
                  <StatusBadge tone={badge.tone} label={badge.label} />
                </td>
                {hasInherited && <td className="dash-td"><span className="stg-pcount">Page</span></td>}
                <td className="dash-td">
                  {rule.patterns && rule.patterns.length > 0 ? (
                    <span className="stg-pcount">
                      {rule.patterns.length} pattern{rule.patterns.length !== 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="stg-pcount">&mdash;</span>
                  )}
                </td>
                {canManage && (
                  <td className="dash-td stg-td-right">
                    {isEditing ? (
                      <span className="stg-row-actions stg-row-actions--pinned">
                        <span className="stg-qbtn" style={{ opacity: 0.6, cursor: "default" }}>Editing&hellip;</span>
                      </span>
                    ) : (
                      <span className="stg-row-actions">
                        <button className="stg-qbtn" onClick={() => startEditContent(rule)} disabled={busy}>Edit</button>
                        <button className="stg-qbtn stg-qbtn--danger" onClick={() => deleteRule(rule.id)} disabled={busy}>Delete</button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
              {isEditing && (
                <tr className="dash-row">
                  <td className="dash-td" colSpan={totalCols}>
                    <div className="stg-editor">
                      {contentFields()}
                      <div className="stg-editor-foot">
                        <button className="btn btn--primary" onClick={saveContentRule} disabled={busy || !formText.trim()}>
                          {busy ? "Saving…" : "Save rule"}
                        </button>
                        <button className="btn btn--ghost" onClick={cancelEdit} disabled={busy}>Cancel</button>
                        <span className="stg-editor-foot-spacer" />
                        <button className="stg-qbtn stg-qbtn--danger" onClick={() => deleteRule(rule.id)} disabled={busy}>
                          Delete rule
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}

        {showApprovalRow && (
          <>
            <tr className="dash-row">
              <td className="dash-td dash-td-title">Changes to matching pages need approval before they serve as trusted.</td>
              <td className="dash-td">
                <StatusBadge tone="approval" label="Approval" />
              </td>
              {hasInherited && <td className="dash-td"><span className="stg-pcount">Page</span></td>}
              <td className="dash-td">
                {approvalRule!.approvers.length > 0 ? (
                  <span className="stg-chip-row">
                    {approvalRule!.approvers.map((a) => (
                      <span key={`${a.type}:${a.id}`} className="pill pill--mono pill--chip" style={{ padding: "1px 8px", fontSize: 11.5 }}>
                        {approverLabel(a, groups, members)}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="stg-pcount">&mdash;</span>
                )}
              </td>
              {canManage && (
                <td className="dash-td stg-td-right">
                  {editingKind === "approval" && editingId === approvalRule!.id ? (
                    <span className="stg-row-actions stg-row-actions--pinned">
                      <span className="stg-qbtn" style={{ opacity: 0.6, cursor: "default" }}>Editing&hellip;</span>
                    </span>
                  ) : (
                    <span className="stg-row-actions">
                      <button className="stg-qbtn" onClick={startEditApproval} disabled={busy}>Edit</button>
                      <button className="stg-qbtn stg-qbtn--danger" onClick={() => deleteRule("approval")} disabled={busy}>Delete</button>
                    </span>
                  )}
                </td>
              )}
            </tr>
            {editingKind === "approval" && editingId === approvalRule!.id && (
              <tr className="dash-row">
                <td className="dash-td" colSpan={totalCols}>
                  <div className="stg-editor">
                    {approvalFields()}
                    <div className="stg-editor-foot">
                      <button className="btn btn--primary" onClick={saveApprovalRule} disabled={busy}>
                        {busy ? "Saving…" : "Save rule"}
                      </button>
                      <button className="btn btn--ghost" onClick={cancelEdit} disabled={busy}>Cancel</button>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </>
        )}

        {rcRules.map((rule) => {
          const isEditing = editingKind === "required-components" && editingId === rule.id;
          return (
            <Fragment key={rule.id}>
              <tr className="dash-row">
                <td className="dash-td dash-td-title">
                  Pages of type &quot;{rule.pageType}&quot; require: {rule.requiredComponentIds.join(", ") || "—"}
                  {rule.requiredFields && rule.requiredFields.length > 0 ? `; fields: ${rule.requiredFields.join(", ")}` : ""}
                  {rule.requireConcepts ? "; at least one concept tag" : ""}
                </td>
                <td className="dash-td">
                  <StatusBadge tone="framework" label="Required shape" />
                </td>
                {hasInherited && <td className="dash-td"><span className="stg-pcount">Page</span></td>}
                <td className="dash-td">
                  <span className="stg-pcount">
                    {rule.requiredComponentIds.length} component{rule.requiredComponentIds.length !== 1 ? "s" : ""}
                  </span>
                </td>
                {canManage && (
                  <td className="dash-td stg-td-right">
                    {isEditing ? (
                      <span className="stg-row-actions stg-row-actions--pinned">
                        <span className="stg-qbtn" style={{ opacity: 0.6, cursor: "default" }}>Editing&hellip;</span>
                      </span>
                    ) : (
                      <span className="stg-row-actions">
                        <button className="stg-qbtn" onClick={() => startEditRc(rule)} disabled={busy}>Edit</button>
                        <button className="stg-qbtn stg-qbtn--danger" onClick={() => deleteRule(rule.id)} disabled={busy}>Delete</button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
              {isEditing && (
                <tr className="dash-row">
                  <td className="dash-td" colSpan={totalCols}>
                    <div className="stg-editor">
                      {rcFields()}
                      <div className="stg-editor-foot">
                        <button className="btn btn--primary" onClick={saveRcRule} disabled={busy || !formPageType.trim()}>
                          {busy ? "Saving…" : "Save rule"}
                        </button>
                        <button className="btn btn--ghost" onClick={cancelEdit} disabled={busy}>Cancel</button>
                        <span className="stg-editor-foot-spacer" />
                        <button className="stg-qbtn stg-qbtn--danger" onClick={() => deleteRule(rule.id)} disabled={busy}>
                          Delete rule
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}

        {isNewDraft && (
          <tr className="dash-row">
            <td className="dash-td" colSpan={totalCols}>
              <div className="stg-editor">
                <FormRow label="Rule kind" hint={KIND_HINT[editingKind!]}>
                  <SegmentedControl<"content" | "approval" | "required-components">
                    value={editingKind!}
                    onChange={handleKindSwitch}
                    disabledOptions={approvalRule ? ["approval"] : []}
                    options={[
                      { value: "content", label: "Content" },
                      { value: "approval", label: "Approval" },
                      { value: "required-components", label: "Required shape" },
                    ]}
                  />
                </FormRow>
                {editingKind === "content" && contentFields()}
                {editingKind === "approval" && approvalFields()}
                {editingKind === "required-components" && rcFields()}
                <div className="stg-editor-foot">
                  <button
                    className="btn btn--primary"
                    onClick={editingKind === "content" ? saveContentRule : editingKind === "approval" ? saveApprovalRule : saveRcRule}
                    disabled={
                      busy ||
                      (editingKind === "content" && !formText.trim()) ||
                      (editingKind === "required-components" && !formPageType.trim())
                    }
                  >
                    {busy ? "Saving…" : "Save rule"}
                  </button>
                  <button className="btn btn--ghost" onClick={cancelEdit} disabled={busy}>Cancel</button>
                </div>
              </div>
            </td>
          </tr>
        )}
      </SettingsTable>

      {canManage && (
        <div className="stg-composer">
          <button className="btn btn--ghost" onClick={openNewDraft} disabled={busy || editingKind !== null}>
            + Add rule
          </button>
        </div>
      )}
    </div>
  );
}
