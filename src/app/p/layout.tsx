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
          <Link className="pubnav-name" href="/">
            curata
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
