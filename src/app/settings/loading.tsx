export default function SettingsLoading() {
  return (
    <>
      <div className="site-bar">
        <span className="skel skel-text" style={{ width: 100 }} />
        <span className="skel skel-text" style={{ width: 60 }} />
      </div>
      <div className="dash-root">
        <div className="dash-workspace">
          <div className="dash-workspace-header dash-workspace-header--top">
            <span className="skel skel-text" style={{ width: 100 }} />
          </div>
          <div className="theme-settings">
            <div className="theme-section">
              <span className="skel skel-text" style={{ width: 40 }} />
              <span className="skel skel-input" />
            </div>
            <div className="theme-section">
              <span className="skel skel-text" style={{ width: 100 }} />
              <span className="skel skel-input" />
            </div>
          </div>
          <div className="dash-workspace-header dash-workspace-header--top">
            <span className="skel skel-text" style={{ width: 60 }} />
          </div>
          <div className="theme-settings">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="theme-section">
                <span className="skel skel-text" style={{ width: 60 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  {Array.from({ length: 4 }).map((_, j) => (
                    <span key={j} className="skel skel-chip" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
