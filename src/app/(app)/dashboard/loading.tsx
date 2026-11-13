/// Skeleton for Home. Mirrors the loaded layout (centered brand, search,
/// "Needs you" strip, folder tree) so nothing jumps when the page arrives.
export default function DashboardLoading() {
  return (
    <div className="abh-root" aria-busy="true" aria-label="Loading">
      <div className="abh-brand">
        <span className="skel" style={{ width: 36, height: 36, borderRadius: 8 }} />
        <span className="skel skel-text" style={{ width: 120, height: 22 }} />
      </div>
      <div className="abh-search">
        <span className="skel skel-text" style={{ width: "45%", margin: "15px 0" }} />
      </div>
      <div className="abh-needs">
        <span className="skel skel-text" style={{ width: 70 }} />
        <span className="skel skel-text" style={{ width: 90, height: 22, borderRadius: 100 }} />
        <span className="skel skel-text" style={{ width: 70, height: 22, borderRadius: 100 }} />
      </div>
      <div className="abh-dir-head">
        <span className="skel skel-text" style={{ width: 60 }} />
      </div>
      <div className="abh-directory">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="abh-folder-label" style={{ cursor: "default" }}>
            <span className="skel skel-text" style={{ width: 14 }} />
            <span className="skel skel-text" style={{ width: `${28 + (i % 3) * 12}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
