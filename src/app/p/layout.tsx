import Link from "next/link";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="site-bar">
        <Link className="site-bar-name" href="/">
          curata
        </Link>
      </div>
      <main className="container main-content">{children}</main>
    </>
  );
}
