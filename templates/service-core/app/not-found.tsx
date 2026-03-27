import { getSiteConfig } from "@/lib/site-config";

const config = getSiteConfig();

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>404</h1>
      <p style={{ fontSize: "1.25rem", color: "#666", marginBottom: "2rem" }}>
        Page not found
      </p>
      <a
        href="/"
        className="btn btn-primary"
        style={{ textDecoration: "none" }}
      >
        Back to {config.business.name}
      </a>
    </div>
  );
}
