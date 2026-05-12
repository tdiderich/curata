import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not Found — curata" };

export default function NotFound() {
  return (
    <div className="error-page">
      <span className="error-page-code">404</span>
      <h1 className="error-page-title">Page not found</h1>
      <p className="error-page-desc">
        The page you&apos;re looking for doesn&apos;t exist or was moved.
      </p>
      <Link href="/dashboard" className="error-page-link">
        &larr; Back to dashboard
      </Link>
    </div>
  );
}
