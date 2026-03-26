"use server";

import { createClient } from "@/lib/supabase/server";
import { notifyDiscord } from "@/lib/discord";
import { redirect } from "next/navigation";

function categorizeFile(mimeType: string): string {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("text/") || mimeType === "application/pdf")
    return "document";
  return "general";
}

export async function createIntake(
  _prevState: { error: string } | null,
  formData: FormData,
): Promise<{ error: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not authenticated" };
  }

  const name = formData.get("name") as string;
  const slug = formData.get("slug") as string;
  const contactName = formData.get("contactName") as string;
  const contactEmail = formData.get("contactEmail") as string;
  const contactPhone = formData.get("contactPhone") as string;
  const businessType = formData.get("businessType") as string;
  const notes = formData.get("notes") as string;

  if (!name || !slug) {
    return { error: "Project name and slug are required." };
  }

  // Validate slug format
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { error: "Slug must be lowercase letters, numbers, and hyphens only." };
  }

  // Create project record
  const { data: project, error: insertError } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name,
      slug,
      status: "intake_received",
      contact_name: contactName || null,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      business_type: businessType || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: `A project with slug "${slug}" already exists.` };
    }
    return { error: insertError.message };
  }

  // Upload files
  const files = formData.getAll("files") as File[];
  for (const file of files) {
    if (!file || file.size === 0) continue;

    const storagePath = `${user.id}/${project.id}/${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("intake-assets")
      .upload(storagePath, file);

    if (uploadError) {
      console.error("Upload error:", uploadError.message);
      continue;
    }

    await supabase.from("assets").insert({
      project_id: project.id,
      file_name: file.name,
      file_type: file.type || "application/octet-stream",
      file_size: file.size,
      storage_path: storagePath,
      category: categorizeFile(file.type),
    });
  }

  // Create initial event
  await supabase.from("project_events").insert({
    project_id: project.id,
    event_type: "intake_submitted",
    to_status: "intake_received",
    metadata: { source: "portal", file_count: files.filter((f) => f.size > 0).length },
  });

  // Notify Discord
  await notifyDiscord({
    name: project.name,
    slug: project.slug,
    id: project.id,
    contactEmail: project.contact_email,
    businessType: project.business_type,
  });

  redirect(`/dashboard/projects/${project.id}`);
}
