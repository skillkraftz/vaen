import { describe, expect, it } from "vitest";
import {
  getEmailSenderConfig,
  getOutreachFromEmail,
} from "./email-sender-config";

describe("email sender config", () => {
  it("prefers RESEND_FROM_EMAIL and formats the sender identity", () => {
    const sender = getEmailSenderConfig({
      RESEND_FROM_EMAIL: "support@skillkraftz.com",
      RESEND_FROM_NAME: "Skillkraftz Support",
      OUTREACH_FROM_EMAIL: "legacy@example.com",
      RESEND_REPLY_TO: "sales@skillkraftz.com",
    });

    expect(sender.fromEmail).toBe("support@skillkraftz.com");
    expect(sender.fromName).toBe("Skillkraftz Support");
    expect(sender.fromAddress).toBe("Skillkraftz Support <support@skillkraftz.com>");
    expect(sender.replyTo).toBe("sales@skillkraftz.com");
    expect(sender.issues).toEqual([]);
  });

  it("falls back to the legacy outreach sender env and default sender name", () => {
    const sender = getEmailSenderConfig({
      OUTREACH_FROM_EMAIL: "legacy@example.com",
    });

    expect(sender.fromEmail).toBe("legacy@example.com");
    expect(sender.fromName).toBe("Skillkraftz Support");
    expect(getOutreachFromEmail({ OUTREACH_FROM_EMAIL: "legacy@example.com" })).toBe("legacy@example.com");
  });

  it("reports invalid sender and reply-to addresses clearly", () => {
    const sender = getEmailSenderConfig({
      RESEND_FROM_EMAIL: "not-an-email",
      RESEND_REPLY_TO: "also-not-an-email",
    });

    expect(sender.issues).toContain("RESEND_FROM_EMAIL or OUTREACH_FROM_EMAIL is not a valid email address.");
    expect(sender.issues).toContain("RESEND_REPLY_TO must be a valid email address when set.");
  });
});
