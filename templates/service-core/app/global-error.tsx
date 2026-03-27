"use client";

/**
 * App Router global error boundary.
 *
 * Without this file, Next.js falls back to the Pages Router error rendering
 * path (load-default-error-components.js → pages/_document → useHtmlContext),
 * which throws "<Html> should not be imported outside of pages/_document"
 * because the HtmlContext provider does not exist in an App Router project.
 *
 * This file MUST render its own <html> and <body> tags because it replaces
 * the root layout when a server-side error occurs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>500</h1>
          <p
            style={{
              fontSize: "1.25rem",
              color: "#666",
              marginBottom: "2rem",
            }}
          >
            Something went wrong
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              cursor: "pointer",
              border: "1px solid #ccc",
              borderRadius: "4px",
              background: "#fff",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
