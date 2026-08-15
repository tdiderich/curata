import Link from "next/link";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Hosted deployments serve /docs; self-hosted OSS intentionally does not,
  // so the docs link only renders on clerk mode.
  const hosted = process.env.AUTH_MODE === "clerk";
  return (
    <>
      <div className="pubnav-wrap">
        <nav className="pubnav">
          <Link className="pubnav-name" href="/" aria-label="curata">
            <svg width={22} height={22} viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path
                d="M 24.43 8.93 A 11 11 0 1 0 24.43 23.07"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <circle cx="27.2" cy="16" r="3" fill="var(--teal)" />
            </svg>
          </Link>
          <div className="pubnav-right">
            {hosted && (
              <Link className="pubnav-link" href="/docs">
                How to use curata
              </Link>
            )}
            <Link className="pubnav-cta" href="/">
              Get started
            </Link>
          </div>
        </nav>
      </div>
      <main className="container main-content">{children}</main>
    </>
  );
}
