import type { ReactNode } from "react";

/**
 * Heading + description shell every settings tab section uses (Organization
 * tags, Content rules, Tags, ...). Presentation only — no state, no fetches.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="stg-section">
      <div className="stg-section-head">
        <h2 className="stg-section-title">{title}</h2>
        {description && <p className="stg-section-desc">{description}</p>}
      </div>
      {children}
    </div>
  );
}
