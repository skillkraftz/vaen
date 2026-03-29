import { Webhook } from "svix";
import type { EmailProviderEvent, OutreachSend } from "./types";

export interface ResendWebhookPayload {
  type: string;
  created_at?: string;
  data?: Record<string, unknown>;
}

export interface ResendWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export interface EmailProviderEventRecord {
  provider: "resend";
  providerEventId: string;
  outreachSendId: string | null;
  eventType: string;
  providerMessageId: string | null;
  payload: Record<string, unknown>;
  processedAt: string;
}

export interface CorrelatedOutreachSend {
  id: string;
  prospect_id: string;
  campaign_id?: string | null;
  project_id: string | null;
  provider_message_id: string | null;
  provider_metadata?: Record<string, unknown> | null;
  status: OutreachSend["status"];
  error_message?: string | null;
}

export interface ResendWebhookStore {
  findEventByProviderEventId(providerEventId: string): Promise<EmailProviderEvent | null>;
  insertEvent(record: EmailProviderEventRecord): Promise<{ duplicate: boolean; id?: string; error?: string }>;
  findOutreachSendByProviderMessageId(providerMessageId: string): Promise<CorrelatedOutreachSend | null>;
  findOutreachSendByTags(tags: Record<string, string>): Promise<CorrelatedOutreachSend | null>;
  updateOutreachSend(
    sendId: string,
    patch: {
      status?: OutreachSend["status"];
      error_message?: string | null;
      provider_metadata: Record<string, unknown>;
    },
  ): Promise<{ error?: string }>;
}

export function getResendWebhookSecret(env: NodeJS.ProcessEnv = process.env) {
  const value = env.RESEND_WEBHOOK_SECRET?.trim();
  return value ? value : null;
}

export function verifyResendWebhookSignature(params: {
  payload: string;
  headers: ResendWebhookHeaders;
  secret?: string | null;
}): { ok: true; event: ResendWebhookPayload; providerEventId: string } | { ok: false; error: string } {
  const secret = params.secret ?? getResendWebhookSecret();
  if (!secret) {
    return { ok: false, error: "RESEND_WEBHOOK_SECRET is not configured." };
  }
  if (!params.headers.id || !params.headers.timestamp || !params.headers.signature) {
    return { ok: false, error: "Missing required Svix webhook headers." };
  }

  try {
    const webhook = new Webhook(secret);
    const event = webhook.verify(params.payload, {
      "svix-id": params.headers.id,
      "svix-timestamp": params.headers.timestamp,
      "svix-signature": params.headers.signature,
    }) as ResendWebhookPayload;
    return {
      ok: true,
      event,
      providerEventId: params.headers.id,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid webhook signature.",
    };
  }
}

export function extractResendWebhookTags(payload: ResendWebhookPayload) {
  const tags = payload.data?.tags;
  if (Array.isArray(tags)) {
    return tags.reduce<Record<string, string>>((acc, tag) => {
      if (
        tag &&
        typeof tag === "object" &&
        "name" in tag &&
        "value" in tag &&
        typeof tag.name === "string" &&
        typeof tag.value === "string"
      ) {
        acc[tag.name] = tag.value;
      }
      return acc;
    }, {});
  }

  if (tags && typeof tags === "object") {
    return Object.entries(tags).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === "string" && value.trim()) {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  return {};
}

export function extractResendProviderMessageId(payload: ResendWebhookPayload) {
  const candidates = [
    payload.data?.email_id,
    payload.data?.message_id,
    payload.data?.emailId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function buildWebhookMetadata(params: {
  existing: Record<string, unknown> | null | undefined;
  eventType: string;
  providerEventId: string;
  providerMessageId: string | null;
  payload: ResendWebhookPayload;
}) {
  const existingMetadata = params.existing ?? {};
  const webhookMetadata = (
    existingMetadata.webhook && typeof existingMetadata.webhook === "object"
      ? existingMetadata.webhook as Record<string, unknown>
      : {}
  );

  return {
    ...existingMetadata,
    webhook: {
      ...webhookMetadata,
      provider: "resend",
      last_event_type: params.eventType,
      last_provider_event_id: params.providerEventId,
      last_provider_message_id: params.providerMessageId,
      last_event_at: typeof params.payload.created_at === "string"
        ? params.payload.created_at
        : new Date().toISOString(),
      last_tags: extractResendWebhookTags(params.payload),
    },
  };
}

function buildSendPatch(params: {
  send: CorrelatedOutreachSend;
  providerEventId: string;
  payload: ResendWebhookPayload;
  providerMessageId: string | null;
}) {
  const eventType = params.payload.type;
  const provider_metadata = buildWebhookMetadata({
    existing: params.send.provider_metadata,
    eventType,
    providerEventId: params.providerEventId,
    providerMessageId: params.providerMessageId,
    payload: params.payload,
  });

  if (eventType === "email.bounced" || eventType === "email.failed") {
    const errorMessage =
      (typeof params.payload.data?.reason === "string" && params.payload.data.reason)
      || (typeof params.payload.data?.response === "string" && params.payload.data.response)
      || `Resend reported ${eventType}.`;

    return {
      status: "failed" as const,
      error_message: errorMessage,
      provider_metadata,
    };
  }

  return {
    provider_metadata,
  };
}

export async function processVerifiedResendWebhook(
  store: ResendWebhookStore,
  params: {
    providerEventId: string;
    payload: ResendWebhookPayload;
    now?: Date;
  },
): Promise<{
  status: "processed" | "duplicate";
  eventId?: string;
  outreachSendId?: string | null;
  updatedSend: boolean;
}> {
  const existing = await store.findEventByProviderEventId(params.providerEventId);
  if (existing) {
    return {
      status: "duplicate",
      eventId: existing.id,
      outreachSendId: existing.outreach_send_id,
      updatedSend: false,
    };
  }

  const providerMessageId = extractResendProviderMessageId(params.payload);
  const tags = extractResendWebhookTags(params.payload);
  const correlatedSend = providerMessageId
    ? await store.findOutreachSendByProviderMessageId(providerMessageId)
    : await store.findOutreachSendByTags(tags);
  const processedAt = (params.now ?? new Date()).toISOString();

  const insert = await store.insertEvent({
    provider: "resend",
    providerEventId: params.providerEventId,
    outreachSendId: correlatedSend?.id ?? null,
    eventType: params.payload.type,
    providerMessageId,
    payload: params.payload as unknown as Record<string, unknown>,
    processedAt,
  });

  if (insert.duplicate) {
    return {
      status: "duplicate",
      eventId: insert.id,
      outreachSendId: correlatedSend?.id ?? null,
      updatedSend: false,
    };
  }

  let updatedSend = false;
  if (correlatedSend) {
    const patch = buildSendPatch({
      send: correlatedSend,
      providerEventId: params.providerEventId,
      payload: params.payload,
      providerMessageId,
    });
    const updateResult = await store.updateOutreachSend(correlatedSend.id, patch);
    if (!updateResult.error) {
      updatedSend = true;
    }
  }

  return {
    status: "processed",
    eventId: insert.id,
    outreachSendId: correlatedSend?.id ?? null,
    updatedSend,
  };
}
