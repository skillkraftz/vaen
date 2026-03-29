import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildOutreachSendBody,
  computeNextFollowUpDate,
  getProspectSendReadiness,
  isDuplicateSendBlocked,
} from "./outreach-execution";
import { getOutreachConfigReadiness, normalizePortalBaseUrl } from "./outreach-config";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("outreach send schema", () => {
  it("adds outreach send history and follow-up fields", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000011_add_outreach_send_history.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.outreach_sends");
    expect(source).toContain("recipient_email text not null");
    expect(source).toContain("provider_message_id");
    expect(source).toContain("attachment_links jsonb");
    expect(source).toContain("outreach_status");
    expect(source).toContain("next_follow_up_due_at");
    expect(source).toContain("follow_up_count");
  });

  it("adds provider metadata for webhook correlation and sender auditability", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000018_add_outreach_send_provider_metadata.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("alter table public.outreach_sends");
    expect(source).toContain("provider_metadata jsonb");
  });
});

describe("outreach execution helpers", () => {
  it("reports structured outreach config readiness", () => {
    const readiness = getOutreachConfigReadiness({
      RESEND_API_KEY: "test-key",
      OUTREACH_FROM_EMAIL: "sales@vaen.space",
      NEXT_PUBLIC_PORTAL_URL: "https://portal.vaen.space/",
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.values.fromEmail).toBe("sales@vaen.space");
    expect(readiness.values.fromName).toBe("Skillkraftz Support");
    expect(readiness.values.portalUrl).toBe("https://portal.vaen.space");
    expect(readiness.checks.portalUrl.ok).toBe(true);
  });

  it("flags missing outreach env configuration clearly", () => {
    const readiness = getOutreachConfigReadiness({
      RESEND_API_KEY: "",
      OUTREACH_FROM_EMAIL: "",
      NEXT_PUBLIC_PORTAL_URL: "portal-without-scheme",
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toContain("RESEND_API_KEY is missing.");
    expect(readiness.issues).toContain("RESEND_FROM_EMAIL or OUTREACH_FROM_EMAIL is missing.");
    expect(readiness.issues).toContain("NEXT_PUBLIC_PORTAL_URL is missing or not a valid absolute URL.");
  });

  it("blocks send readiness when recipient or package data is missing", () => {
    const readiness = getProspectSendReadiness({
      prospect: {
        contact_email: null,
        converted_project_id: null,
        outreach_status: "draft",
      },
      outreachPackage: null,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toContain("Prospect contact email is missing.");
    expect(readiness.issues).toContain("Outreach package has not been generated.");
  });

  it("blocks send readiness when outreach config is incomplete", () => {
    const readiness = getProspectSendReadiness({
      prospect: {
        contact_email: "alex@example.com",
        converted_project_id: "proj-1",
        outreach_status: "ready",
      },
      outreachPackage: {
        id: "pkg-1",
        email_subject: "Acme Painting",
        email_body: "Hello",
        status: "ready",
      },
      configReadiness: getOutreachConfigReadiness({
        RESEND_API_KEY: "",
        OUTREACH_FROM_EMAIL: "sales@vaen.space",
        NEXT_PUBLIC_PORTAL_URL: "",
      }),
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toContain("RESEND_API_KEY is missing.");
    expect(readiness.issues).toContain("NEXT_PUBLIC_PORTAL_URL is missing or not a valid absolute URL.");
  });

  it("detects rapid duplicate sends for the same recipient and subject", () => {
    const blocked = isDuplicateSendBlocked({
      sends: [
        {
          recipient_email: "alex@example.com",
          subject: "Acme Painting: website improvement ideas",
          status: "sent",
          created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        },
      ],
      recipientEmail: "alex@example.com",
      subject: "Acme Painting: website improvement ideas",
      now: new Date(),
    });

    expect(blocked).toBe(true);
  });

  it("builds a link-based outreach send body", () => {
    const body = buildOutreachSendBody({
      body: "Hello from vaen",
      projectUrl: "http://localhost:3100/dashboard/projects/proj-1",
      screenshotLinks: ["https://signed.test/screenshot-1"],
    });

    expect(body).toContain("Hello from vaen");
    expect(body).toContain("Project review:");
    expect(body).toContain("Screenshot review links:");
  });

  it("computes the next follow-up date from the send timestamp", () => {
    const sentAt = new Date("2026-03-29T10:00:00Z");
    expect(computeNextFollowUpDate(sentAt, 0)).toContain("2026-04-01");
    expect(computeNextFollowUpDate(sentAt, 1)).toContain("2026-04-05");
  });

  it("normalizes portal urls for outbound links", () => {
    expect(normalizePortalBaseUrl("https://portal.vaen.space/")).toBe("https://portal.vaen.space");
    expect(normalizePortalBaseUrl("not-a-url")).toBe(null);
  });

  it("threads centralized sender config, provider metadata, and resend tags through the send path", () => {
    const resendSource = readFileSync(join(REPO_ROOT, "apps/portal/src/lib/resend.ts"), "utf-8");
    const helperSource = readFileSync(join(REPO_ROOT, "apps/portal/src/app/dashboard/prospects/prospect-send-helpers.ts"), "utf-8");
    const webhookSource = readFileSync(join(REPO_ROOT, "apps/portal/src/app/api/webhooks/resend/route.ts"), "utf-8");

    expect(resendSource).toContain("getEmailSenderConfig");
    expect(resendSource).toContain("reply_to");
    expect(resendSource).toContain("tags");
    expect(helperSource).toContain("buildResendTags");
    expect(helperSource).toContain("provider_metadata");
    expect(helperSource).toContain("provider_message_id");
    expect(helperSource).toContain("sendType");
    expect(helperSource).toContain("sequenceStep");
    expect(webhookSource).toContain("verifyResendWebhookSignature");
    expect(webhookSource).toContain('from("email_provider_events")');
  });
});
