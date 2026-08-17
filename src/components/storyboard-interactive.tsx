"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/settings/segmented-control";

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
