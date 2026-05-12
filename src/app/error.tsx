"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="error-page">
      <span className="error-page-code">error</span>
      <h1 className="error-page-title">Something went wrong</h1>
      <p className="error-page-desc">An unexpected error occurred.</p>
      <button className="error-page-btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
