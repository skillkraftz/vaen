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
  it("prefers RESEND_FROM_EMAIL over the legacy outreach sender env", () => {
    expect(getOutreachFromEmail({
      OUTREACH_FROM_EMAIL: "legacy@skillkraftz.com",
      RESEND_FROM_EMAIL: "support@skillkraftz.com",
    })).toBe("support@skillkraftz.com");
  });

  it("normalizes portal base urls", () => {
    expect(normalizePortalBaseUrl("https://portal.vaen.space/")).toBe("https://portal.vaen.space");
    expect(normalizePortalBaseUrl("http://localhost:3100///")).toBe("http://localhost:3100");
    expect(normalizePortalBaseUrl("localhost:3100")).toBe(null);
  });

  it("returns structured readiness info with explicit checks", () => {
    const readiness = getOutreachConfigReadiness({
      RESEND_API_KEY: "test-key",
      RESEND_FROM_EMAIL: "support@skillkraftz.com",
      RESEND_FROM_NAME: "Skillkraftz Support",
      RESEND_REPLY_TO: "sales@skillkraftz.com",
      NEXT_PUBLIC_PORTAL_URL: "https://portal.vaen.space",
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks.resendApiKey.ok).toBe(true);
    expect(readiness.checks.fromEmail.ok).toBe(true);
    expect(readiness.checks.fromName.ok).toBe(true);
    expect(readiness.checks.replyTo.ok).toBe(true);
    expect(readiness.checks.portalUrl.ok).toBe(true);
    expect(readiness.values.fromAddress).toBe("Skillkraftz Support <support@skillkraftz.com>");
    expect(readiness.values.replyTo).toBe("sales@skillkraftz.com");
  });

  it("treats an invalid reply-to as a blocked config issue", () => {
    const readiness = getOutreachConfigReadiness({
      RESEND_API_KEY: "test-key",
      RESEND_FROM_EMAIL: "support@skillkraftz.com",
      RESEND_REPLY_TO: "invalid",
      NEXT_PUBLIC_PORTAL_URL: "https://portal.vaen.space",
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.replyTo.ok).toBe(false);
    expect(readiness.issues).toContain("RESEND_REPLY_TO must be a valid email address when set.");
  });

  it("documents the required outreach env vars in the portal example file", () => {
    const envExample = readFileSync(join(REPO_ROOT, "apps/portal/.env.example"), "utf-8");
    expect(envExample).toContain("RESEND_API_KEY");
    expect(envExample).toContain("RESEND_FROM_EMAIL");
    expect(envExample).toContain("RESEND_FROM_NAME");
    expect(envExample).toContain("RESEND_REPLY_TO");
    expect(envExample).toContain("OUTREACH_FROM_EMAIL");
    expect(envExample).toContain("NEXT_PUBLIC_PORTAL_URL");
  });
});
