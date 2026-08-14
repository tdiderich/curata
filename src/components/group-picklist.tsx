"use client";

import { useState } from "react";

export interface GroupOption {
  id: string;
  name: string;
}

/**
 * Per-member dropdown: check/uncheck a group to add/remove that member from
 * it. Reuses the kg-picker popover styling (tag-picker.tsx) — same look,
 * immediate toggle instead of a staged "save" step since membership changes
 * are one API call each.
 */
export function GroupPicklist({
  memberGroupIds,
  allGroups,
  onToggle,
  busy,
}: {
  memberGroupIds: Set<string>;
  allGroups: GroupOption[];
  onToggle: (groupId: string, add: boolean) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (allGroups.length === 0) {
    return <span className="members-groups-empty">&mdash;</span>;
  }

  return (
    <span className="kg-picker">
      <button
        type="button"
        className="kg-picker-btn"
        onClick={() => setOpen(!open)}
        disabled={busy}
      >
        {memberGroupIds.size > 0 ? `${memberGroupIds.size} group${memberGroupIds.size === 1 ? "" : "s"}` : "add to group"}{" "}
        <span aria-hidden>&#9662;</span>
      </button>
      {open && (
        <>
          <span className="kg-picker-backdrop" onClick={() => setOpen(false)} />
          <span className="kg-picker-menu">
            <span className="kg-picker-list">
              {allGroups.map((g) => {
                const on = memberGroupIds.has(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={on ? "kg-picker-item kg-picker-item-on" : "kg-picker-item"}
                    onClick={() => onToggle(g.id, !on)}
                    disabled={busy}
                  >
                    <span className="kg-picker-check">{on ? "✓" : ""}</span>
                    {g.name}
                  </button>
                );
              })}
            </span>
          </span>
        </>
      )}
    </span>
  );
}
