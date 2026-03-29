import { createClient } from "@/lib/supabase/server";
import type { RevisionSource } from "@/lib/revision-helpers";
import { DRAFT_DEFAULTS, ensureDraftDefaults } from "@/lib/draft-helpers";
import type { Project } from "@/lib/types";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

export type AuthoritativeRequestSource = "revision" | "legacy_draft" | "none";

export async function createRevisionAndSetCurrent(
  supabase: PortalSupabase,
  projectId: string,
  source: RevisionSource,
  requestData: Record<string, unknown>,
  parentRevisionId?: string | null,
  summary?: string | null,
): Promise<string | null> {
  try {
    const { data: rev, error } = await supabase
      .from("project_request_revisions")
      .insert({
        project_id: projectId,
        source,
        request_data: requestData,
        parent_revision_id: parentRevisionId ?? null,
        summary: summary ?? null,
      })
      .select("id")
      .single();

    if (error || !rev) return null;

    await supabase
      .from("projects")
      .update({ current_revision_id: rev.id })
      .eq("id", projectId);

    return rev.id;
  } catch {
    return null;
  }
}

export async function loadCurrentDraft(
  supabase: PortalSupabase,
  projectId: string,
): Promise<{ draft: Record<string, unknown>; revisionId: string | null; error?: string }> {
  const { data: project, error } = await supabase
    .from("projects")
    .select("current_revision_id, draft_request")
    .eq("id", projectId)
    .single();

  if (error || !project) {
    return {
      draft: { ...DRAFT_DEFAULTS },
      revisionId: null,
      error: error?.message ?? "Project not found",
    };
  }

  if (project.current_revision_id) {
    try {
      const { data: rev } = await supabase
        .from("project_request_revisions")
        .select("request_data")
        .eq("id", project.current_revision_id)
        .single();
      if (rev?.request_data) {
        return {
          draft: ensureDraftDefaults(rev.request_data as Record<string, unknown>),
          revisionId: project.current_revision_id,
        };
      }
    } catch {
      // fall through to legacy column
    }
  }

  const existing = (project.draft_request as Record<string, unknown>) ?? {};
  return { draft: ensureDraftDefaults(existing), revisionId: null };
}

export async function loadAuthoritativeRequestData(
  supabase: PortalSupabase,
  project: Pick<Project, "current_revision_id" | "draft_request">,
): Promise<{
  requestData: Record<string, unknown> | null;
  source: AuthoritativeRequestSource;
  revisionId: string | null;
}> {
  if (project.current_revision_id) {
    try {
      const { data: rev } = await supabase
        .from("project_request_revisions")
        .select("request_data")
        .eq("id", project.current_revision_id)
        .single();

      if (rev?.request_data) {
        return {
          requestData: ensureDraftDefaults(rev.request_data as Record<string, unknown>),
          source: "revision",
          revisionId: project.current_revision_id,
        };
      }
    } catch {
      // fall through to legacy draft fallback
    }
  }

  const legacyDraft = (project.draft_request as Record<string, unknown> | null) ?? null;
  if (legacyDraft) {
    return {
      requestData: ensureDraftDefaults(legacyDraft),
      source: "legacy_draft",
      revisionId: null,
    };
  }

  return {
    requestData: null,
    source: "none",
    revisionId: project.current_revision_id ?? null,
  };
}
