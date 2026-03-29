import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  processVerifiedResendWebhook,
  verifyResendWebhookSignature,
  type EmailProviderEventRecord,
  type CorrelatedOutreachSend,
  type ResendWebhookStore,
} from "@/lib/resend-webhooks";
import type { EmailProviderEvent, OutreachSend } from "@/lib/types";

function createSupabaseWebhookStore(): ResendWebhookStore {
  const admin = createAdminClient();

  return {
    async findEventByProviderEventId(providerEventId) {
      const { data } = await admin
        .from("email_provider_events")
        .select("*")
        .eq("provider", "resend")
        .eq("provider_event_id", providerEventId)
        .maybeSingle();

      return (data ?? null) as EmailProviderEvent | null;
    },
    async insertEvent(record) {
      const { data, error } = await admin
        .from("email_provider_events")
        .insert({
          provider: record.provider,
          provider_event_id: record.providerEventId,
          outreach_send_id: record.outreachSendId,
          event_type: record.eventType,
          provider_message_id: record.providerMessageId,
          payload: record.payload,
          processed_at: record.processedAt,
        })
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505") {
          const existing = await this.findEventByProviderEventId(record.providerEventId);
          return { duplicate: true, id: existing?.id };
        }
        return { duplicate: false, error: error.message };
      }

      return { duplicate: false, id: data?.id };
    },
    async findOutreachSendByProviderMessageId(providerMessageId) {
      const { data } = await admin
        .from("outreach_sends")
        .select("id, prospect_id, campaign_id, project_id, provider_message_id, provider_metadata, status, error_message")
        .eq("provider_message_id", providerMessageId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return (data ?? null) as CorrelatedOutreachSend | null;
    },
    async findOutreachSendByTags(tags) {
      const prospectId = tags.prospect_id ?? null;
      if (!prospectId) return null;

      let query = admin
        .from("outreach_sends")
        .select("id, prospect_id, campaign_id, project_id, provider_message_id, provider_metadata, status, error_message")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (tags.project_id) query = query.eq("project_id", tags.project_id);
      if (tags.campaign_id) query = query.eq("campaign_id", tags.campaign_id);

      const { data } = await query;
      return ((data ?? [])[0] ?? null) as CorrelatedOutreachSend | null;
    },
    async updateOutreachSend(sendId, patch) {
      const { error } = await admin
        .from("outreach_sends")
        .update({
          ...(patch.status ? { status: patch.status } : {}),
          ...(typeof patch.error_message !== "undefined" ? { error_message: patch.error_message } : {}),
          provider_metadata: patch.provider_metadata,
        })
        .eq("id", sendId);

      return error ? { error: error.message } : {};
    },
  };
}

export async function POST(request: Request) {
  const payload = await request.text();
  const verification = verifyResendWebhookSignature({
    payload,
    headers: {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
  });

  if (!verification.ok) {
    return NextResponse.json({ ok: false, error: verification.error }, { status: 400 });
  }

  const result = await processVerifiedResendWebhook(createSupabaseWebhookStore(), {
    providerEventId: verification.providerEventId,
    payload: verification.event,
  });

  return NextResponse.json({
    ok: true,
    status: result.status,
    eventId: result.eventId ?? null,
    outreachSendId: result.outreachSendId ?? null,
    updatedSend: result.updatedSend,
  }, { status: 200 });
}
