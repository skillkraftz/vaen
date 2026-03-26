/**
 * Discord webhook notifications for project lifecycle events.
 *
 * Portal-side notifications cover intake events.
 * Worker-side notifications cover build/review events (in run-job.ts).
 */

interface ProjectNotification {
  name: string;
  slug: string;
  id: string;
  contactEmail?: string | null;
  businessType?: string | null;
}

type EventType =
  | "intake_received"
  | "intake_processed"
  | "intake_approved"
  | "intake_needs_revision"
  | "exported";

const EVENT_CONFIG: Record<
  EventType,
  { title: string; color: number }
> = {
  intake_received: { title: "New Intake Received", color: 0x3b82f6 },
  intake_processed: { title: "Intake Processed", color: 0x8b5cf6 },
  intake_approved: { title: "Intake Approved", color: 0x22c55e },
  intake_needs_revision: { title: "Revision Requested", color: 0xf59e0b },
  exported: { title: "Exported to Generator", color: 0x06b6d4 },
};

export async function notifyDiscord(
  project: ProjectNotification,
  eventType: EventType = "intake_received",
): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("[discord] DISCORD_WEBHOOK_URL not set, skipping notification");
    return;
  }

  const config = EVENT_CONFIG[eventType];
  if (!config) return;

  const portalUrl = (process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3100").replace(/\/+$/, "");
  const projectUrl = `${portalUrl}/dashboard/projects/${project.id}`;

  const fields = [
    { name: "Project", value: project.name, inline: true },
    { name: "Slug", value: `\`${project.slug}\``, inline: true },
  ];

  if (project.businessType) {
    fields.push({ name: "Type", value: project.businessType, inline: true });
  }
  if (project.contactEmail) {
    fields.push({ name: "Contact", value: project.contactEmail, inline: true });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: config.title,
            description: `[View in portal](${projectUrl})`,
            color: config.color,
            fields,
            timestamp: new Date().toISOString(),
            footer: { text: "vaen.space" },
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("[discord] Webhook failed:", response.status, await response.text());
    }
  } catch (err) {
    console.error("[discord] Webhook error:", err);
  }
}
