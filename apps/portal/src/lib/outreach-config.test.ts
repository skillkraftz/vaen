import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getOutreachConfigReadiness,
  getOutreachFromEmail,
  normalizePortalBaseUrl,
} from "./outreach-config";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("outreach config helpers", () => {
  it("prefers OUTREACH_FROM_EMAIL over RESEND_FROM_EMAIL", () => {
    expect(getOutreachFromEmail({
      OUTREACH_FROM_EMAIL: "sales@vaen.space",
      RESEND_FROM_EMAIL: "fallback@vaen.space",
    })).toBe("sales@vaen.space");
  });

  it("normalizes portal base urls", () => {
    expect(normalizePortalBaseUrl("https://portal.vaen.space/")).toBe("https://portal.vaen.space");
    expect(normalizePortalBaseUrl("http://localhost:3100///")).toBe("http://localhost:3100");
    expect(normalizePortalBaseUrl("localhost:3100")).toBe(null);
  });

  it("returns structured readiness info with explicit checks", () => {
    const readiness = getOutreachConfigReadiness({
      RESEND_API_KEY: "test-key",
      RESEND_FROM_EMAIL: "hello@vaen.space",
      NEXT_PUBLIC_PORTAL_URL: "https://portal.vaen.space",
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks.resendApiKey.ok).toBe(true);
    expect(readiness.checks.fromEmail.ok).toBe(true);
    expect(readiness.checks.portalUrl.ok).toBe(true);
  });

  it("documents the required outreach env vars in the portal example file", () => {
    const envExample = readFileSync(join(REPO_ROOT, "apps/portal/.env.example"), "utf-8");
    expect(envExample).toContain("RESEND_API_KEY");
    expect(envExample).toContain("OUTREACH_FROM_EMAIL");
    expect(envExample).toContain("RESEND_FROM_EMAIL");
    expect(envExample).toContain("NEXT_PUBLIC_PORTAL_URL");
  });
});
