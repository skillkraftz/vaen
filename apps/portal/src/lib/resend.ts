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
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.OUTREACH_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL;

  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured." };
  }

  if (!from) {
    return { ok: false, error: "OUTREACH_FROM_EMAIL is not configured." };
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
