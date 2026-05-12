export default function DashboardLoading() {
  return (
    <div className="dash-root">
      <div className="dash-workspace-header dash-workspace-header--top">
        <span className="skel skel-text" style={{ width: 60 }} />
        <span className="skel skel-text" style={{ width: 40 }} />
        <div className="dash-header-actions">
          <span className="skel skel-input" />
          <span className="skel skel-btn" />
        </div>
      </div>
      <div className="dash-workspace">
        <table className="dash-table">
          <thead>
            <tr>
              <th className="dash-th dash-th-title"><span className="skel skel-text" style={{ width: 40 }} /></th>
              <th className="dash-th"><span className="skel skel-text" style={{ width: 50 }} /></th>
              <th className="dash-th"><span className="skel skel-text" style={{ width: 60 }} /></th>
              <th className="dash-th"><span className="skel skel-text" style={{ width: 50 }} /></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="dash-row">
                <td className="dash-td dash-td-title"><span className="skel skel-text" style={{ width: `${60 + (i % 3) * 20}%` }} /></td>
                <td className="dash-td"><span className="skel skel-text" style={{ width: 70 }} /></td>
                <td className="dash-td"><span className="skel skel-text" style={{ width: 60 }} /></td>
                <td className="dash-td"><span className="skel skel-text" style={{ width: 50 }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
