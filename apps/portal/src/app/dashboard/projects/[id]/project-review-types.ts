export interface ReviewManifestFile {
  file_name: string;
  path: string;
  size_bytes: number;
  sha256: string;
  modified_at: string;
  uploaded_storage_path?: string | null;
  uploaded_asset_id?: string | null;
  uploaded_at?: string | null;
}

export interface ReviewManifest {
  schema_version: number;
  status: "completed" | "failed";
  project_id: string | null;
  slug: string;
  revision_id: string | null;
  job_id: string | null;
  review_started_at: string | null;
  review_completed_at: string | null;
  served_url: string | null;
  served_title: string | null;
  port: number | null;
  site_dir: string;
  screenshots_dir: string;
  manifest_path: string;
  screenshot_files: ReviewManifestFile[];
  review_probe_path?: string | null;
  content_verification?: {
    status: "matched" | "mismatched" | "unknown";
    expected_business_name: string | null;
    observed_home_title: string | null;
    observed_home_h1: string | null;
    mismatches: string[];
  };
  runtime_config_probe_path?: string | null;
  runtime_config_status?: "matched" | "mismatched" | "unknown";
  expected_business_name?: string | null;
  runtime_business_name?: string | null;
  runtime_config_path?: string | null;
  runtime_cwd?: string | null;
  review_identity_status?: "matched" | "mismatched" | "unknown";
  mismatch_stage?: "generated_source" | "review_probe" | "unknown" | null;
  site_config_snapshot_path?: string | null;
  site_source_summary_path?: string | null;
  site_identity_scan_path?: string | null;
  upload_summary?: {
    compared_at: string;
    matched: boolean;
    manifest_count: number;
    uploaded_count: number;
    missing_in_upload: string[];
    extra_uploaded: string[];
    hash_mismatches: string[];
  };
}

export interface ArtifactStatus {
  hasClientRequest: boolean;
  hasWorkspace: boolean;
  hasSiteBuild: boolean;
  hasScreenshots: boolean;
  screenshotCount: number;
  screenshotNames: string[];
  screenshotManifest: ReviewManifest | null;
}
