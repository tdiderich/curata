import type { ReactNode } from "react";

/** Labeled field wrapper: mono uppercase label + input(s) + hint line. */
export function FormRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="stg-form-row">
      <span className="stg-form-row-label">{label}</span>
      {children}
      {hint && <div className="stg-form-row-hint">{hint}</div>}
    </div>
  );
}
