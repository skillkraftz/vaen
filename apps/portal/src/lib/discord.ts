/**
 * Discord webhook notification for intake events.
 */

interface IntakeNotification {
  name: string;
  slug: string;
  id: string;
  contactEmail?: string | null;
  businessType?: string | null;
}

export async function notifyDiscord(project: IntakeNotification): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("[discord] DISCORD_WEBHOOK_URL not set, skipping notification");
    return;
  }

  const portalUrl = (process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3100").replace(/\/+$/, "");
  const projectUrl = `${portalUrl}/dashboard/projects/${project.id}`;

  const fields = [
    { name: "Project", value: project.name, inline: true },
    { name: "Slug", value: `\`${project.slug}\``, inline: true },
    { name: "Status", value: "intake_received", inline: true },
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
            title: "New Intake Received",
            description: `[View in portal](${projectUrl})`,
            color: 0x3b82f6,
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
