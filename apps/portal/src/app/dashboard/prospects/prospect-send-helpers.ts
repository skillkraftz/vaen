import { revalidatePath } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { getEmailSenderConfig } from "@/lib/email-sender-config";
import {
  buildOutreachSendBody,
  computeNextFollowUpDate,
  getProspectSendReadiness,
  isDuplicateSendBlocked,
} from "@/lib/outreach-execution";
import { sendEmailViaResend } from "@/lib/resend";
import { buildResendTags } from "@/lib/resend-tags";
import { getOutreachConfigReadiness } from "@/lib/outreach-config";
import type { OutreachSend, Prospect, ProspectOutreachPackage } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function loadLatestProspectOutreachPackage(
  supabase: SupabaseServerClient,
  prospectId: string,
) {
  const { data } = await supabase
    .from("prospect_outreach_packages")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false })
    .limit(1);

  return ((data ?? [])[0] ?? null) as ProspectOutreachPackage | null;
}

export function readResendReadyAttachmentPaths(outreachPackage: ProspectOutreachPackage | null) {
  const resendReady = (outreachPackage?.package_data?.resend_ready as Record<string, unknown> | undefined) ?? {};
  return Array.isArray(resendReady.attachment_paths)
    ? resendReady.attachment_paths.filter((item): item is string => typeof item === "string")
    : [];
}

export async function executeProspectOutreachSend(params: {
  supabase: SupabaseServerClient;
  prospect: Prospect;
  outreachPackage: ProspectOutreachPackage | null;
  confirm: boolean;
  subjectOverride?: string | null;
  bodyOverride?: string | null;
  campaignId?: string | null;
  sendType?: "manual" | "sequence";
  sequenceStep?: number | null;
}) {
  if (!params.confirm) {
    return { error: "Send confirmation is required." };
  }

  const configReadiness = getOutreachConfigReadiness();
  const senderConfig = getEmailSenderConfig();
  const resendTags = buildResendTags({
    campaignId: params.campaignId ?? params.prospect.campaign_id ?? null,
    prospectId: params.prospect.id,
    projectId: params.prospect.converted_project_id ?? null,
    sendType: params.sendType ?? "manual",
    sequenceStep: params.sequenceStep ?? null,
  });
  const providerMetadata = {
    sender: {
      from_email: senderConfig.fromEmail,
      from_name: senderConfig.fromName,
      from_address: senderConfig.fromAddress,
      reply_to: senderConfig.replyTo,
    },
    resend: {
      tags: resendTags,
    },
    vaen: {
      campaign_id: params.campaignId ?? params.prospect.campaign_id ?? null,
      prospect_id: params.prospect.id,
      project_id: params.prospect.converted_project_id ?? null,
      send_type: params.sendType ?? "manual",
      sequence_step: params.sequenceStep ?? null,
    },
  };
  const subject = params.subjectOverride?.trim() || params.outreachPackage?.email_subject || null;
  const body = params.bodyOverride?.trim() || params.outreachPackage?.email_body || null;
  const readinessPackage = subject || body
    ? {
        id: params.outreachPackage?.id ?? "sequence-template",
        email_subject: subject,
        email_body: body,
        status: params.outreachPackage?.status ?? "ready",
      }
    : null;

  const readiness = getProspectSendReadiness({
    prospect: params.prospect,
    outreachPackage: readinessPackage,
    configReadiness,
  });

  if (!readiness.ready) {
    if (subject && body && params.prospect.contact_email) {
      const { data: blockedRow } = await params.supabase
        .from("outreach_sends")
        .insert({
          prospect_id: params.prospect.id,
          outreach_package_id: params.outreachPackage?.id ?? null,
          client_id: params.prospect.converted_client_id,
          project_id: params.prospect.converted_project_id,
          campaign_id: params.campaignId ?? params.prospect.campaign_id ?? null,
          recipient_email: params.prospect.contact_email,
          subject,
          body,
          attachment_links: [],
          provider_metadata: providerMetadata,
          status: "blocked",
          provider: "resend",
          error_message: readiness.issues.join(" "),
        })
        .select("id")
        .single();

      return { error: readiness.issues.join(" "), sendId: blockedRow?.id, status: "blocked" as const };
    }
    return { error: readiness.issues.join(" "), status: "blocked" as const };
  }

  const priorSends = (
    await params.supabase
      .from("outreach_sends")
      .select("*")
      .eq("prospect_id", params.prospect.id)
      .order("created_at", { ascending: false })
      .limit(10)
  ).data ?? [];

  const blocked = isDuplicateSendBlocked({
    sends: priorSends as OutreachSend[],
    recipientEmail: params.prospect.contact_email!,
    subject: subject!,
  });

  if (blocked) {
    const { data: blockedRow } = await params.supabase
      .from("outreach_sends")
      .insert({
        prospect_id: params.prospect.id,
        outreach_package_id: params.outreachPackage?.id ?? null,
        client_id: params.prospect.converted_client_id,
        project_id: params.prospect.converted_project_id,
        campaign_id: params.campaignId ?? params.prospect.campaign_id ?? null,
        recipient_email: params.prospect.contact_email!,
        subject: subject!,
        body: body!,
        attachment_links: [],
        provider_metadata: providerMetadata,
        status: "blocked",
        provider: "resend",
        error_message: "Blocked duplicate send within the safety window.",
      })
      .select("id")
      .single();

    return {
      error: "A matching outreach email was already sent recently.",
      sendId: blockedRow?.id,
      status: "blocked" as const,
    };
  }

  const projectUrl = params.prospect.converted_project_id && configReadiness.values.portalUrl
    ? `${configReadiness.values.portalUrl}/dashboard/projects/${params.prospect.converted_project_id}`
    : null;

  const screenshotLinks: string[] = [];
  for (const storagePath of readResendReadyAttachmentPaths(params.outreachPackage)) {
    const { data } = await params.supabase.storage
      .from("review-screenshots")
      .createSignedUrl(storagePath, 7 * 24 * 60 * 60);
    if (data?.signedUrl) screenshotLinks.push(data.signedUrl);
  }

  const sendBody = buildOutreachSendBody({
    body: body!,
    projectUrl,
    screenshotLinks,
  });

  const { data: sendRow, error: sendInsertError } = await params.supabase
    .from("outreach_sends")
    .insert({
      prospect_id: params.prospect.id,
      outreach_package_id: params.outreachPackage?.id ?? null,
      client_id: params.prospect.converted_client_id,
      project_id: params.prospect.converted_project_id,
      campaign_id: params.campaignId ?? params.prospect.campaign_id ?? null,
      recipient_email: params.prospect.contact_email!,
      subject: subject!,
      body: sendBody,
      attachment_links: screenshotLinks,
      provider_metadata: {
        ...providerMetadata,
        attachments: {
          count: screenshotLinks.length,
          strategy: "signed_link",
        },
      },
      status: "pending",
      provider: "resend",
    })
    .select("id")
    .single();

  if (sendInsertError || !sendRow) {
    return { error: sendInsertError?.message ?? "Failed to create outreach send record." };
  }

  const resendResult = await sendEmailViaResend({
    to: params.prospect.contact_email!,
    subject: subject!,
    text: sendBody,
    tags: resendTags,
  });

  const sentAt = new Date();
  if (!resendResult.ok) {
    await params.supabase
      .from("outreach_sends")
      .update({
        status: "failed",
        error_message: resendResult.error ?? "Unknown Resend error.",
      })
      .eq("id", sendRow.id);

    return {
      error: resendResult.error ?? "Failed to send outreach email.",
      sendId: sendRow.id,
      status: "failed" as const,
    };
  }

  await params.supabase
    .from("outreach_sends")
    .update({
      status: "sent",
      provider_message_id: resendResult.messageId ?? null,
      provider_metadata: {
        ...providerMetadata,
        attachments: {
          count: screenshotLinks.length,
          strategy: "signed_link",
        },
        resend: {
          tags: resendTags,
          message_id: resendResult.messageId ?? null,
        },
      },
      sent_at: sentAt.toISOString(),
    })
    .eq("id", sendRow.id);

  await params.supabase
    .from("prospects")
    .update({
      outreach_status: "sent",
      last_outreach_sent_at: sentAt.toISOString(),
      next_follow_up_due_at: computeNextFollowUpDate(sentAt, params.prospect.follow_up_count ?? 0),
      follow_up_count: (params.prospect.follow_up_count ?? 0) + 1,
      metadata: {
        ...(params.prospect.metadata ?? {}),
        latest_outreach_send_id: sendRow.id,
      },
    })
    .eq("id", params.prospect.id);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath(`/dashboard/prospects/${params.prospect.id}`);

  return {
    sendId: sendRow.id,
    sentAt: sentAt.toISOString(),
    status: "sent" as const,
  };
}
