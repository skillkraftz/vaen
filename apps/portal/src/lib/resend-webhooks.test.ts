import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Webhook } from "svix";
import {
  extractResendProviderMessageId,
  extractResendWebhookTags,
  processVerifiedResendWebhook,
  verifyResendWebhookSignature,
  type CorrelatedOutreachSend,
  type EmailProviderEventRecord,
  type ResendWebhookPayload,
  type ResendWebhookStore,
} from "./resend-webhooks";

const REPO_ROOT = resolve(__dirname, "../../../..");
const SRC_ROOT = resolve(__dirname, "..");

function signPayload(params: { secret?: string; eventId?: string; payload: string; timestamp?: Date }) {
  const secret = params.secret ?? "whsec_test";
  const eventId = params.eventId ?? "msg_test_1";
  const timestamp = params.timestamp ?? new Date();
  const webhook = new Webhook(secret);

  return {
    id: eventId,
    timestamp: String(Math.floor(timestamp.getTime() / 1000)),
    signature: webhook.sign(eventId, timestamp, params.payload),
  };
}

function makeSend(overrides: Partial<CorrelatedOutreachSend> = {}): CorrelatedOutreachSend {
  return {
    id: "send-1",
    prospect_id: "pros-1",
    campaign_id: "camp-1",
    project_id: "proj-1",
    provider_message_id: "email_123",
    provider_metadata: {
      resend: {
        tags: [
          { name: "campaign_id", value: "camp-1" },
          { name: "prospect_id", value: "pros-1" },
        ],
      },
    },
    status: "sent",
    error_message: null,
    ...overrides,
  };
}

class MemoryWebhookStore implements ResendWebhookStore {
  events: Array<{
    id: string;
    provider: "resend";
    provider_event_id: string;
    outreach_send_id: string | null;
    event_type: string;
    provider_message_id: string | null;
    payload: Record<string, unknown>;
    processed_at: string;
    created_at: string;
  }> = [];

  sends: CorrelatedOutreachSend[] = [];

  constructor(sends: CorrelatedOutreachSend[] = []) {
    this.sends = sends;
  }

  async findEventByProviderEventId(providerEventId: string) {
    return this.events.find((event) => event.provider_event_id === providerEventId) ?? null;
  }

  async insertEvent(record: EmailProviderEventRecord) {
    const existing = await this.findEventByProviderEventId(record.providerEventId);
    if (existing) return { duplicate: true, id: existing.id };

    const created = {
      id: `evt-${this.events.length + 1}`,
      provider: record.provider,
      provider_event_id: record.providerEventId,
      outreach_send_id: record.outreachSendId,
      event_type: record.eventType,
      provider_message_id: record.providerMessageId,
      payload: record.payload,
      processed_at: record.processedAt,
      created_at: record.processedAt,
    } as const;
    this.events.push(created);
    return { duplicate: false, id: created.id };
  }

  async findOutreachSendByProviderMessageId(providerMessageId: string) {
    return this.sends.find((send) => send.provider_message_id === providerMessageId) ?? null;
  }

  async findOutreachSendByTags(tags: Record<string, string>) {
    return this.sends.find((send) => (
      (!tags.prospect_id || send.prospect_id === tags.prospect_id)
      && (!tags.project_id || send.project_id === tags.project_id)
      && (!tags.campaign_id || send.campaign_id === tags.campaign_id)
    )) ?? null;
  }

  async updateOutreachSend(
    sendId: string,
    patch: { status?: CorrelatedOutreachSend["status"]; error_message?: string | null; provider_metadata: Record<string, unknown> },
  ) {
    const send = this.sends.find((item) => item.id === sendId);
    if (!send) return { error: "not found" };
    send.provider_metadata = patch.provider_metadata;
    if (patch.status) send.status = patch.status;
    if (typeof patch.error_message !== "undefined") send.error_message = patch.error_message;
    return {};
  }
}

describe("resend webhook schema and route", () => {
  it("adds provider event storage with idempotency", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000019_create_email_provider_events.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.email_provider_events");
    expect(source).toContain("unique (provider, provider_event_id)");
    expect(source).toContain("provider_message_id");
    expect(source).toContain("payload jsonb");
    expect(source).toContain("outreach_send_id uuid references public.outreach_sends");
  });

  it("uses raw body Svix verification in the resend webhook route", () => {
    const routePath = join(SRC_ROOT, "app/api/webhooks/resend/route.ts");
    const source = readFileSync(routePath, "utf-8");
    expect(source).not.toContain("webhook scaffold is present but not wired");
    expect(source).toContain("request.text()");
    expect(source).toContain("svix-id");
    expect(source).toContain("svix-timestamp");
    expect(source).toContain("svix-signature");
    expect(source).toContain("verifyResendWebhookSignature");
    expect(source).toContain("processVerifiedResendWebhook");
  });
});

describe("resend webhook verification", () => {
  it("verifies a valid signed payload", () => {
    const payload = JSON.stringify({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "email_123", tags: [{ name: "prospect_id", value: "pros-1" }] },
    });
    const headers = signPayload({ payload });

    const result = verifyResendWebhookSignature({
      payload,
      headers,
      secret: "whsec_test",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.type).toBe("email.delivered");
      expect(result.providerEventId).toBe(headers.id);
    }
  });

  it("rejects an invalid signature", () => {
    const payload = JSON.stringify({ type: "email.delivered", data: { email_id: "email_123" } });

    const result = verifyResendWebhookSignature({
      payload,
      headers: {
        id: "msg_bad",
        timestamp: String(Math.floor(Date.now() / 1000)),
        signature: "v1,invalid",
      },
      secret: "whsec_test",
    });

    expect(result.ok).toBe(false);
  });
});

describe("resend webhook ingestion", () => {
  it("persists delivered events and correlates via provider_message_id", async () => {
    const store = new MemoryWebhookStore([makeSend()]);
    const payload: ResendWebhookPayload = {
      type: "email.delivered",
      created_at: "2026-03-29T16:00:00Z",
      data: {
        email_id: "email_123",
        tags: [{ name: "prospect_id", value: "pros-1" }],
      },
    };

    const result = await processVerifiedResendWebhook(store, {
      providerEventId: "evt-delivered-1",
      payload,
      now: new Date("2026-03-29T16:01:00Z"),
    });

    expect(result.status).toBe("processed");
    expect(result.outreachSendId).toBe("send-1");
    expect(store.events).toHaveLength(1);
    expect(store.events[0].provider_message_id).toBe("email_123");
    expect(store.sends[0].provider_metadata?.webhook).toMatchObject({
      last_event_type: "email.delivered",
      last_provider_event_id: "evt-delivered-1",
      last_provider_message_id: "email_123",
    });
  });

  it("ignores duplicate provider events idempotently", async () => {
    const store = new MemoryWebhookStore([makeSend()]);
    const payload: ResendWebhookPayload = {
      type: "email.delivered",
      data: { email_id: "email_123" },
    };

    await processVerifiedResendWebhook(store, {
      providerEventId: "evt-duplicate-1",
      payload,
      now: new Date(),
    });
    const second = await processVerifiedResendWebhook(store, {
      providerEventId: "evt-duplicate-1",
      payload,
      now: new Date(),
    });

    expect(second.status).toBe("duplicate");
    expect(store.events).toHaveLength(1);
  });

  it("falls back to resend tags when provider_message_id is missing", async () => {
    const store = new MemoryWebhookStore([
      makeSend({
        id: "send-2",
        provider_message_id: null,
        prospect_id: "pros-2",
        project_id: "proj-2",
        campaign_id: "camp-2",
      }),
    ]);

    const result = await processVerifiedResendWebhook(store, {
      providerEventId: "evt-tags-1",
      payload: {
        type: "email.delivered",
        data: {
          tags: [
            { name: "prospect_id", value: "pros-2" },
            { name: "project_id", value: "proj-2" },
            { name: "campaign_id", value: "camp-2" },
          ],
        },
      },
      now: new Date(),
    });

    expect(result.outreachSendId).toBe("send-2");
    expect(store.events[0].outreach_send_id).toBe("send-2");
  });

  it("marks bounced and failed events on the correlated send", async () => {
    const store = new MemoryWebhookStore([makeSend()]);

    await processVerifiedResendWebhook(store, {
      providerEventId: "evt-bounced-1",
      payload: {
        type: "email.bounced",
        data: {
          email_id: "email_123",
          reason: "Mailbox unavailable",
        },
      },
      now: new Date(),
    });

    expect(store.sends[0].status).toBe("failed");
    expect(store.sends[0].error_message).toBe("Mailbox unavailable");
  });
});

describe("resend webhook helpers", () => {
  it("extracts provider message ids and tags safely", () => {
    expect(extractResendProviderMessageId({
      type: "email.delivered",
      data: { email_id: "email_123" },
    })).toBe("email_123");

    expect(extractResendWebhookTags({
      type: "email.delivered",
      data: {
        tags: [
          { name: "campaign_id", value: "camp-1" },
          { name: "prospect_id", value: "pros-1" },
        ],
      },
    })).toEqual({
      campaign_id: "camp-1",
      prospect_id: "pros-1",
    });
  });
});
