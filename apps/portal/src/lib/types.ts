/** Database row types matching the migration schema. */

export interface Project {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  business_type: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  client_summary: string | null;
  draft_request: Record<string, unknown> | null;
  final_request: Record<string, unknown> | null;
  missing_info: MissingInfoItem[] | null;
  recommendations: IntakeRecommendations | null;
  /** Revision pointers — null until migrations are applied */
  current_revision_id: string | null;
  last_exported_revision_id: string | null;
  last_generated_revision_id: string | null;
  last_reviewed_revision_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequestRevision {
  id: string;
  project_id: string;
  source: "intake_processor" | "user_edit" | "ai_import" | "manual";
  request_data: Record<string, unknown>;
  parent_revision_id: string | null;
  summary: string | null;
  created_at: string;
}

export interface RevisionAsset {
  revision_id: string;
  asset_id: string;
  role: "logo" | "hero" | "gallery" | "content" | "reference";
  sort_order: number;
}

export interface MissingInfoItem {
  field: string;
  label: string;
  severity: "required" | "recommended" | "optional";
  hint?: string;
}

export interface IntakeRecommendations {
  template: { id: string; reason: string };
  modules: Array<{ id: string; reason: string }>;
  notes?: string;
}

export interface Asset {
  id: string;
  project_id: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  storage_path: string;
  category: string;
  asset_type: "uploaded" | "generated" | "review_screenshot" | null;
  source_job_id: string | null;
  request_revision_id: string | null;
  created_at: string;
}

export interface ProjectEvent {
  id: string;
  project_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface JobRecord {
  id: string;
  project_id: string;
  job_type: string;
  status: "pending" | "running" | "completed" | "failed";
  payload: Record<string, unknown>;
  result: { success: boolean; message: string; artifacts?: string[]; error?: string } | null;
  stdout: string | null;
  stderr: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}
