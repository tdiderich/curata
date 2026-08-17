"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/settings/segmented-control";
import { toast } from "@/components/toast";

/** ci-chip and dash-attention-chip are real toggles, not static pills — show the click. */
export function StoryboardFilterChips() {
  const [ciActive, setCiActive] = useState(false);
  const [attnActive, setAttnActive] = useState(true);

  return (
    <>
      <button
        type="button"
        className="ci-chip"
        onClick={() => setCiActive((v) => !v)}
        style={ciActive ? { borderColor: "var(--card-hover-border)", background: "var(--surface-strong)" } : undefined}
      >
        <span className="ci-chip-dot" style={{ background: "var(--teal)" }} aria-hidden />
        ci-chip
        <span className="ci-chip-cnt">{ciActive ? "on" : "off"}</span>
      </button>
      <button
        type="button"
        className={`dash-attention-chip${attnActive ? " dash-attention-chip--active" : ""}`}
        onClick={() => setAttnActive((v) => !v)}
      >
        dash-attention-chip
      </button>
    </>
  );
}

/** Toast is timed and dismissible, the opposite of a static pill — trigger a real one. */
export function StoryboardToastTrigger() {
  return (
    <>
      <button className="btn btn--ghost" onClick={() => toast.success("Saved")}>
        Fire success toast
      </button>
      <button className="btn btn--ghost" onClick={() => toast.error("Something broke")}>
        Fire error toast
      </button>
    </>
  );
}

/** The one catalog entry that needs local state: SegmentedControl is controlled. */
export function StoryboardSegmentedControl() {
  const [period, setPeriod] = useState<"month" | "annual">("month");
  const [kind, setKind] = useState<"topic" | "vendor" | "finding">("topic");

  return (
    <>
      <SegmentedControl
        value={period}
        onChange={setPeriod}
        options={[
          { value: "month", label: "Monthly" },
          { value: "annual", label: "Annual" },
        ]}
      />
      <SegmentedControl
        value={kind}
        onChange={setKind}
        options={[
          { value: "topic", label: "topic", icon: <span className="pg-tag-kind-dot pg-dot-topic" aria-hidden /> },
          { value: "vendor", label: "vendor", icon: <span className="pg-tag-kind-dot pg-dot-vendor" aria-hidden /> },
          { value: "finding", label: "finding", icon: <span className="pg-tag-kind-dot pg-dot-finding" aria-hidden /> },
        ]}
      />
    </>
  );
}
