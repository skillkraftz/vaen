/** Database row types matching the migration schema. */

export interface Client {
  id: string;
  user_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  business_type: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  client_id: string | null;
  variant_of: string | null;
  variant_label: string | null;
  name: string;
  slug: string;
  status: string;
  archived_at: string | null;
  archived_by: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  business_type: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  selected_modules?: SelectedModule[] | null;
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

export interface SelectedModule {
  id: string;
  config?: Record<string, unknown>;
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
  checksum_sha256?: string | null;
  metadata?: Record<string, unknown>;
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

export interface PackagePricing {
  id: string;
  item_type: "template" | "module";
  label: string;
  description: string | null;
  setup_price_cents: number;
  recurring_price_cents: number;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PricingChangeEvent {
  id: string;
  pricing_item_id: string;
  changed_by: string;
  changed_by_email: string | null;
  previous_values: Record<string, unknown>;
  next_values: Record<string, unknown>;
  change_reason: string | null;
  created_at: string;
}

export interface Quote {
  id: string;
  project_id: string;
  quote_number: number;
  revision_id: string | null;
  template_id: string;
  selected_modules_snapshot: SelectedModule[];
  status: "draft" | "sent" | "accepted" | "rejected" | "expired";
  setup_subtotal_cents: number;
  recurring_subtotal_cents: number;
  discount_cents: number;
  discount_percent: number | null;
  discount_reason: string | null;
  discount_approved_by: string | null;
  setup_total_cents: number;
  recurring_total_cents: number;
  valid_days: number;
  valid_until: string | null;
  client_name: string | null;
  client_email: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface QuoteLine {
  id: string;
  quote_id: string;
  line_type: "template" | "module" | "addon" | "discount";
  reference_id: string | null;
  label: string;
  description: string | null;
  setup_price_cents: number;
  recurring_price_cents: number;
  quantity: number;
  sort_order: number;
}

export interface Contract {
  id: string;
  quote_id: string;
  project_id: string;
  client_id: string | null;
  contract_number: number;
  status: "active" | "completed" | "cancelled";
  billing_type: "one_time" | "monthly" | "annual";
  setup_amount_cents: number;
  recurring_amount_cents: number;
  started_at: string;
  renewal_at: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
