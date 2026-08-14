import type { ReactNode } from "react";

/**
 * Thin shell around the `dash-table` markup pattern (already used by
 * Members and Groups) so every settings tab renders the same table frame
 * instead of hand-rolling `<table className="dash-table">` per component.
 * Intentionally not a column-def abstraction — callers keep full control of
 * their row JSX, this just standardizes the outer shell + empty state.
 */
export function SettingsTable({
  head,
  children,
  empty,
}: {
  head: ReactNode;
  children: ReactNode;
  /** Rendered instead of the table when there are no rows to show. */
  empty?: ReactNode;
}) {
  if (empty) {
    return <div className="dash-empty stg-table">{empty}</div>;
  }
  return (
    <table className="dash-table stg-table">
      <thead>
        <tr>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
