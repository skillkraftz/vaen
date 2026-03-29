import type {
  OutreachSend,
  Prospect,
  ProspectOutreachPackage,
} from "./types";
import type { OutreachConfigReadiness } from "./outreach-config";

const DUPLICATE_SEND_WINDOW_MS = 10 * 60 * 1000;

export function getProspectSendReadiness(params: {
  prospect: Pick<Prospect, "contact_email" | "converted_project_id" | "outreach_status">;
  outreachPackage: Pick<ProspectOutreachPackage, "id" | "email_subject" | "email_body" | "status"> | null;
  configReadiness?: OutreachConfigReadiness;
}) {
  const issues: string[] = [];
  if (!params.prospect.contact_email) {
    issues.push("Prospect contact email is missing.");
  }
  if (!params.outreachPackage) {
    issues.push("Outreach package has not been generated.");
  }
  if (params.outreachPackage && !params.outreachPackage.email_subject) {
    issues.push("Outreach email subject is missing.");
  }
  if (params.outreachPackage && !params.outreachPackage.email_body) {
    issues.push("Outreach email body is missing.");
  }
  if (!params.prospect.converted_project_id) {
    issues.push("Prospect has not been linked to a project yet.");
  }
  if (params.configReadiness && !params.configReadiness.ready) {
    issues.push(...params.configReadiness.issues);
  }

  return {
    ready: issues.length === 0,
    issues,
  };
}

export function isDuplicateSendBlocked(params: {
  sends: Array<Pick<OutreachSend, "recipient_email" | "subject" | "status" | "created_at">>;
  recipientEmail: string;
  subject: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  return params.sends.some((send) => {
    if (send.status !== "sent") return false;
    if (send.recipient_email !== params.recipientEmail) return false;
    if (send.subject !== params.subject) return false;
    const age = now.getTime() - new Date(send.created_at).getTime();
    return age >= 0 && age < DUPLICATE_SEND_WINDOW_MS;
  });
}

export function computeNextFollowUpDate(sentAt: Date, followUpCount: number) {
  const next = new Date(sentAt);
  const days = followUpCount > 0 ? 7 : 3;
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

export function buildOutreachSendBody(params: {
  body: string;
  projectUrl?: string | null;
  screenshotLinks: string[];
}) {
  const lines = [params.body];
  if (params.projectUrl) {
    lines.push("", `Project review: ${params.projectUrl}`);
  }
  if (params.screenshotLinks.length > 0) {
    lines.push("", "Screenshot review links:");
    for (const link of params.screenshotLinks) {
      lines.push(`- ${link}`);
    }
  }
  return lines.join("\n");
}
