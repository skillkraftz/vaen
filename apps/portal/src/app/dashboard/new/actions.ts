"use server";

import { createClient } from "@/lib/supabase/server";
import { notifyDiscord } from "@/lib/discord";
import { redirect } from "next/navigation";
import { categorizeFile } from "../projects/[id]/project-asset-helpers";
import { createRevisionAndSetCurrent } from "../projects/[id]/project-revision-helpers";
import {
  asNullableString,
  buildInitialRequestSnapshot,
  type ClientSeed,
} from "./client-intake-helpers";

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

  const clientMode = ((formData.get("clientMode") as string) || "new") as "new" | "existing";

  const name = (formData.get("name") as string)?.trim();
  const slug = (formData.get("slug") as string)?.trim();
  const contactName = asNullableString(formData.get("contactName"));
  const contactEmail = asNullableString(formData.get("contactEmail"));
  const contactPhone = asNullableString(formData.get("contactPhone"));
  const businessType = asNullableString(formData.get("businessType"));
  const notes = asNullableString(formData.get("notes"));

  if (!name || !slug) {
    return { error: "Project name and slug are required." };
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { error: "Slug must be lowercase letters, numbers, and hyphens only." };
  }

  let clientId: string | null = null;
  let clientSeed: ClientSeed;

  if (clientMode === "existing") {
    const existingClientId = (formData.get("existingClientId") as string)?.trim();
    if (!existingClientId) {
      return { error: "Select an existing client." };
    }

    const { data: existingClient, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", existingClientId)
      .eq("user_id", user.id)
      .single();

    if (clientError || !existingClient) {
      return { error: "Selected client was not found." };
    }

    clientId = existingClient.id;
    clientSeed = {
      name: existingClient.name,
      businessType: existingClient.business_type,
      contactName: existingClient.contact_name,
      contactEmail: existingClient.contact_email,
      contactPhone: existingClient.contact_phone,
      notes: existingClient.notes,
    };
  } else {
    const clientName = asNullableString(formData.get("clientName")) ?? name;
    const clientBusinessType = asNullableString(formData.get("clientBusinessType")) ?? businessType;
    const clientContactName = asNullableString(formData.get("clientContactName")) ?? contactName;
    const clientContactEmail = asNullableString(formData.get("clientContactEmail")) ?? contactEmail;
    const clientContactPhone = asNullableString(formData.get("clientContactPhone")) ?? contactPhone;
    const clientNotes = asNullableString(formData.get("clientNotes")) ?? notes;

    if (!clientName) {
      return { error: "Client name is required." };
    }

    const { data: createdClient, error: clientInsertError } = await supabase
      .from("clients")
      .insert({
        user_id: user.id,
        name: clientName,
        contact_name: clientContactName,
        contact_email: clientContactEmail,
        contact_phone: clientContactPhone,
        business_type: clientBusinessType,
        notes: clientNotes,
      })
      .select("id, name, contact_name, contact_email, contact_phone, business_type, notes")
      .single();

    if (clientInsertError || !createdClient) {
      return { error: clientInsertError?.message ?? "Failed to create client." };
    }

    clientId = createdClient.id;
    clientSeed = {
      name: createdClient.name,
      businessType: createdClient.business_type,
      contactName: createdClient.contact_name,
      contactEmail: createdClient.contact_email,
      contactPhone: createdClient.contact_phone,
      notes: createdClient.notes,
    };
  }

  const initialSnapshot = buildInitialRequestSnapshot({
    name,
    businessType,
    contactName,
    contactEmail,
    contactPhone,
    notes,
  });

  const { data: project, error: insertError } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      client_id: clientId,
      name,
      slug,
      status: "intake_received",
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      business_type: businessType,
      notes,
      draft_request: initialSnapshot,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: `A project with slug "${slug}" already exists.` };
    }
    return { error: insertError.message };
  }

  await createRevisionAndSetCurrent(
    supabase,
    project.id,
    "manual",
    initialSnapshot,
    null,
    "Initial project creation snapshot",
  );

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

  await supabase.from("project_events").insert({
    project_id: project.id,
    event_type: "intake_submitted",
    to_status: "intake_received",
    metadata: {
      source: "portal",
      file_count: files.filter((file) => file.size > 0).length,
      client_id: clientId,
      client_mode: clientMode,
      client_name: clientSeed.name,
    },
  });

  await notifyDiscord({
    name: project.name,
    slug: project.slug,
    id: project.id,
    contactEmail: project.contact_email,
    businessType: project.business_type,
  });

  redirect(`/dashboard/projects/${project.id}`);
}
