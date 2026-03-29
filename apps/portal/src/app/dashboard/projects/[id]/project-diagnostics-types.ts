export interface ProjectDiagnostics {
  draft: {
    exists: boolean;
    hasVersion: boolean;
    hasBusiness: boolean;
    hasContact: boolean;
    hasServices: boolean;
    servicesCount: number;
    topLevelKeys: string[];
  };
  requestSource: "revision" | "legacy_draft" | "none";
  hasLegacyDraftFallback: boolean;
  files: {
    hasExportedRequest: boolean;
    hasWorkspace: boolean;
    hasBuild: boolean;
    hasScreenshots: boolean;
    screenshotCount: number;
    hasPromptTxt: boolean;
  };
  jobs: {
    lastGenerate: { id: string; status: string; completedAt: string | null } | null;
    lastReview: { id: string; status: string; completedAt: string | null } | null;
  };
  timestamps: {
    lastProcessedAt: string | null;
    lastExportedAt: string | null;
    lastGeneratedAt: string | null;
    lastReviewedAt: string | null;
  };
  screenshotsStale: boolean;
  liveMissingInfo: Array<{ field: string; label: string; severity: string; hint?: string }>;
  revisions: {
    count: number;
    currentSource: string | null;
    exportStale: boolean;
    generateStale: boolean;
    reviewStale: boolean;
  } | null;
}
