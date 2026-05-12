export default function PageLoading() {
  return (
    <div className="page-detail-layout">
      <div className="page-toolbar">
        <span className="skel skel-text" style={{ width: 60 }} />
        <span className="skel skel-text" style={{ width: 120 }} />
        <div className="page-toolbar-spacer" />
        <div className="page-toolbar-right">
          <span className="skel skel-btn" />
          <span className="skel skel-btn" />
          <span className="skel skel-btn" />
        </div>
      </div>
      <div className="page-content-wrap">
        <div className="page-detail-content">
          <div className="skel skel-heading" />
          <div className="skel skel-block" />
          <div className="skel skel-block" style={{ width: "80%" }} />
          <div className="skel skel-heading" style={{ width: "40%", marginTop: 32 }} />
          <div className="skel skel-block" />
          <div className="skel skel-block" style={{ width: "60%" }} />
        </div>
      </div>
    </div>
  );
}
