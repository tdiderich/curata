interface StoryboardSectionProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

/** One catalog entry: a heading, a one-line usage note, and a row of live examples. */
export function StoryboardSection({ title, description, children }: StoryboardSectionProps) {
  return (
    <div className="stg-section">
      <div className="stg-section-head">
        <h2 className="stg-section-title">{title}</h2>
        <p className="stg-section-desc">{description}</p>
      </div>
      <div className="storyboard-row">{children}</div>
    </div>
  );
}
