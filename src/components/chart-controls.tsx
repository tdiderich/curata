"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { basePath } from "@/lib/api-fetch";
import type { ChartChild } from "@/lib/chart";
import { toast } from "@/components/toast";
import { ContextMenu, type ContextMenuItem } from "@/components/context-menu";

/**
 * "Checked": one click sets lastCheckedAt on this edge. Same call as the
 * mark_verified tool, so a human clicking and an agent calling leave the
 * same state. A check is per edge, so the toast names the other nodes the
 * same page or asset still needs a look under.
 */
export function ChartCheckButton({ child, term }: { child: ChartChild; term: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(terms: string[]) {
    setBusy(true);
    setError(null);
    try {
      for (const t of terms) {
        const res = await fetch(`${basePath}/api/dependents/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: child.slug ?? undefined, url: child.url ?? undefined, term: t, status: "holds" }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
      }
      toast.success(child.alsoUnder.length > 0
        ? `Checked ${child.label} here. Still needs a look under ${child.alsoUnder.join(", ")}.`
        : `Checked ${child.label}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="chart-check">
      <button type="button" className="stg-qbtn" disabled={busy} onClick={() => void check([term])} title="Looked at it, it's right for this node">
        {busy ? "Saving" : "Mark complete"}
      </button>
      {error && <span className="stg-dep-verify-error">{error}</span>}
    </span>
  );
}

export function ChartNodeToggle({ term, field, value, onLabel, offLabel }: { term: string; field: "hidden" | "promoted"; value: boolean; onLabel: string; offLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function flip() {
    setBusy(true);
    try {
      await fetch(`${basePath}/api/chart`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term, [field]: !value }) });
      router.refresh();
    } finally { setBusy(false); }
  }
  return <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void flip()}>{value ? onLabel : offLabel}</button>;
}

/**
 * Node header menu: view the source page, edit the per-node instructions
 * (appended to every copied prompt), hide or show on the map. Editing opens
 * a panel under the header; same field set_chart_node instructions= writes.
 */
export function NodeMenu({ term, source, instructions, hidden, canEdit }: { term: string; source: { slug: string } | null; instructions: string | null; hidden: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(instructions ?? "");
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(`${basePath}/api/chart`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term, ...body }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
      toast.success(ok);
      setEditing(false);
      router.refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }

  const items: ContextMenuItem[] = [];
  if (source) items.push({ label: "View source page", onClick: () => router.push(`/pages/${source.slug}`) });
  if (canEdit) {
    items.push({ label: instructions ? "Edit instructions" : "Add instructions", onClick: () => { setDraft(instructions ?? ""); setEditing(true); } });
    items.push({ label: "", divider: true, onClick: () => {} });
    items.push({ label: hidden ? "Show on content map" : "Hide from content map", onClick: () => void patch({ hidden: !hidden }, hidden ? "Back on the map." : "Hidden from the map. Find it under \"hidden nodes\" at the bottom of the map.") });
  }
  if (items.length === 0) return null;

  return (
    <>
      <button ref={setAnchor} type="button" className="btn btn--ghost chart-node-kebab" aria-label="Node actions" onClick={() => setOpen((v) => !v)}>···</button>
      <ContextMenu items={items} anchorEl={anchor} open={open} onClose={() => setOpen(false)} />
      {editing && (
        <div className="cmap-instr-panel">
          <span className="cmap-source-label">Instructions for agents</span>
          <textarea
            className="stg-input cmap-instr-text"
            rows={3}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            placeholder={'Added to every prompt copied from this node. Example: "Read the launch, decide if it matters to this customer, and add an agenda item to their priorities page if so."'}
          />
          <div className="cmap-instr-actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void patch({ instructions: draft }, draft.trim() ? "Instructions saved." : "Instructions cleared.")}>Save</button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
