import { getOutreachConfigReadiness, getOutreachFromEmail } from "./outreach-config";

export interface ResendSendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmailViaResend(input: ResendSendEmailInput): Promise<{
  ok: boolean;
  messageId?: string;
  error?: string;
}> {
  const readiness = getOutreachConfigReadiness();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = getOutreachFromEmail();

  if (!readiness.ready || !apiKey || !from) {
    return {
      ok: false,
      error: readiness.issues.length > 0
        ? readiness.issues.join(" ")
        : "Outreach configuration is incomplete.",
    };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });

    const payload = await response.json().catch(() => null) as { id?: string; message?: string } | null;
    if (!response.ok) {
      return {
        ok: false,
        error: payload?.message ?? `Resend returned ${response.status}.`,
      };
    }

    return { ok: true, messageId: payload?.id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
