export type StatusBadgeTone =
  | "block"
  | "review"
  | "guidance"
  | "approval"
  | "topic"
  | "vendor"
  | "finding"
  | "framework"
  | "template"
  | "depends"
  | "asserts"
  | "references"
  | "instantiates"
  | "trusted"
  | "behind"
  | "untrusted"
  | "needs-change";

/**
 * Dot + label chip. Enforcement tones (block/review/guidance/approval) are
 * this app's rule vocabulary; the concept-kind tones reuse the same shape so
 * the Tags tab badge matches the knowledge-graph legend. Relation tones
 * (depends/asserts/references/instantiates) and trust tones
 * (trusted/behind/untrusted) serve the Dependencies tab.
 */
export function StatusBadge({ tone, label }: { tone: StatusBadgeTone; label: string }) {
  return (
    <span className={`pill pill--mono pill--${tone}`}>
      <span className="pill-dot" aria-hidden />
      {label}
    </span>
  );
}
