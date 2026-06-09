"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="error-page">
      <span className="error-page-code">error</span>
      <h1 className="error-page-title">Something went wrong</h1>
      <p className="error-page-desc">
        An unexpected error occurred. It may be temporary — trying again usually fixes it.
      </p>
      <div className="error-page-actions">
        <button className="error-page-btn" onClick={reset}>
          Try again
        </button>
        <Link className="error-page-link" href="/dashboard">
          Back to dashboard
        </Link>
      </div>
      {error.digest && <p className="error-page-digest">Error ID: {error.digest}</p>}
    </div>
  );
}
