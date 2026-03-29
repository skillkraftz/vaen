function asTrimmedValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export interface EmailSenderConfig {
  fromEmail: string | null;
  fromName: string;
  fromAddress: string | null;
  replyTo: string | null;
  issues: string[];
}

export function getEmailSenderConfig(env: NodeJS.ProcessEnv = process.env): EmailSenderConfig {
  const fromEmail = asTrimmedValue(env.RESEND_FROM_EMAIL) ?? asTrimmedValue(env.OUTREACH_FROM_EMAIL);
  const fromName = asTrimmedValue(env.RESEND_FROM_NAME) ?? "Skillkraftz Support";
  const replyTo = asTrimmedValue(env.RESEND_REPLY_TO);
  const issues: string[] = [];

  if (!fromEmail) {
    issues.push("RESEND_FROM_EMAIL or OUTREACH_FROM_EMAIL is missing.");
  } else if (!looksLikeEmail(fromEmail)) {
    issues.push("RESEND_FROM_EMAIL or OUTREACH_FROM_EMAIL is not a valid email address.");
  }

  if (replyTo && !looksLikeEmail(replyTo)) {
    issues.push("RESEND_REPLY_TO must be a valid email address when set.");
  }

  return {
    fromEmail,
    fromName,
    fromAddress: fromEmail ? `${fromName} <${fromEmail}>` : null,
    replyTo,
    issues,
  };
}

export function getOutreachFromEmail(env: NodeJS.ProcessEnv = process.env) {
  return getEmailSenderConfig(env).fromEmail;
}
