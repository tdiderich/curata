"use client";

import "@/app/globals.css";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="error-page">
          <span className="error-page-code">error</span>
          <h1 className="error-page-title">Something went wrong</h1>
          <p className="error-page-desc">A critical error occurred.</p>
          <button className="error-page-btn" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
