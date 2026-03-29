import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  isContinuationEligible,
  getContinuationBlockedReason,
} from "./continuation-helpers";

const REPO_ROOT = resolve(__dirname, "../../../..");
const SRC_ROOT = resolve(__dirname, "..");

/* ── Schema ─────────────────────────────────────────────────────── */

describe("continuation_requests schema", () => {
  it("adds continuation_requests table with expected columns and RLS", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000017_create_continuation_requests.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.continuation_requests");
    expect(source).toContain("prospect_id uuid not null references public.prospects(id)");
    expect(source).toContain("project_id uuid not null references public.projects(id)");
    expect(source).toContain("campaign_id uuid references public.campaigns(id)");
    expect(source).toContain("request_type text not null check (request_type in ('pending_review'))");
    expect(source).toContain("status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled', 'blocked'))");
    expect(source).toContain("resolved_at timestamptz");
    expect(source).toContain("resolved_by uuid references auth.users(id)");
    expect(source).toContain("enable row level security");
    expect(source).toContain("create policy continuation_requests_access");
    expect(source).toContain("user_id = auth.uid()");
  });
});

/* ── Type ────────────────────────────────────────────────────────── */

describe("continuation request type", () => {
  it("exports ContinuationRequest type from types.ts", () => {
    const typesPath = join(SRC_ROOT, "lib/types.ts");
    const source = readFileSync(typesPath, "utf-8");
    expect(source).toContain("ContinuationRequestType");
    expect(source).toContain("ContinuationRequestStatus");
    expect(source).toContain("interface ContinuationRequest");
    expect(source).toContain("pending_review");
    expect(source).toContain('"pending" | "completed" | "cancelled" | "blocked"');
  });
});

/* ── Eligibility logic ──────────────────────────────────────────── */

describe("continuation eligibility", () => {
  it("marks workspace_generated as eligible for pending_review", () => {
    expect(isContinuationEligible("workspace_generated", "pending_review")).toBe(true);
  });

  it("marks review_ready as eligible for pending_review", () => {
    expect(isContinuationEligible("review_ready", "pending_review")).toBe(true);
  });

  it("marks build_in_progress as not eligible for pending_review", () => {
    expect(isContinuationEligible("build_in_progress", "pending_review")).toBe(false);
  });

  it("marks build_failed as not eligible for pending_review", () => {
    expect(isContinuationEligible("build_failed", "pending_review")).toBe(false);
  });

  it("marks intake_received as not eligible for pending_review", () => {
    expect(isContinuationEligible("intake_received", "pending_review")).toBe(false);
  });
});

describe("continuation blocked reasons", () => {
  it("returns in-progress reason for build_in_progress", () => {
    expect(getContinuationBlockedReason("build_in_progress", "pending_review")).toBe(
      "Generation is still in progress.",
    );
  });

  it("returns failure reason for build_failed", () => {
    expect(getContinuationBlockedReason("build_failed", "pending_review")).toContain("failed");
  });

  it("returns null for eligible states", () => {
    expect(getContinuationBlockedReason("workspace_generated", "pending_review")).toBe(null);
  });
});

/* ── Helper exports ─────────────────────────────────────────────── */

describe("continuation helpers module", () => {
  it("exports all required functions", () => {
    const helpersPath = join(SRC_ROOT, "lib/continuation-helpers.ts");
    expect(existsSync(helpersPath)).toBe(true);
    const source = readFileSync(helpersPath, "utf-8");
    expect(source).toContain("export async function createContinuationRequest");
    expect(source).toContain("export async function resolveContinuationRequest");
    expect(source).toContain("export async function listContinuationRequests");
    expect(source).toContain("export function isContinuationEligible");
    expect(source).toContain("export function getContinuationBlockedReason");
  });

  it("deduplicates pending requests for the same prospect and type", () => {
    const source = readFileSync(join(SRC_ROOT, "lib/continuation-helpers.ts"), "utf-8");
    expect(source).toContain("Avoid duplicates");
    expect(source).toContain('.eq("status", "pending")');
    expect(source).toContain("maybeSingle");
  });
});

/* ── Integration: automation creates continuation ───────────────── */

describe("automation continuation integration", () => {
  it("creates continuation request when generate dispatched with review_site level", () => {
    const actionsPath = join(SRC_ROOT, "app/dashboard/prospects/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("createContinuationRequest");
    expect(source).toContain("pending_review");
    expect(source).toContain("review_site automation blocked by in-progress generation");
  });

  it("exports continuePendingReviewAction from prospect actions", () => {
    const actionsPath = join(SRC_ROOT, "app/dashboard/prospects/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function continuePendingReviewAction");
    expect(source).toContain("isContinuationEligible");
    expect(source).toContain("resolveContinuationRequest");
    expect(source).toContain("runReviewAction");
  });
});

/* ── Integration: prospect detail page ──────────────────────────── */

describe("prospect continuation UI", () => {
  it("loads and displays continuation requests on the prospect detail page", () => {
    const pagePath = join(SRC_ROOT, "app/dashboard/prospects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("listContinuationRequests");
    expect(source).toContain("isContinuationEligible");
    expect(source).toContain("getContinuationBlockedReason");
    expect(source).toContain("ProspectContinuationPanel");
    expect(source).toContain("continuationItems");
  });

  it("has a continuation panel client component", () => {
    const panelPath = join(SRC_ROOT, "app/dashboard/prospects/prospect-continuation-panel.tsx");
    expect(existsSync(panelPath)).toBe(true);
    const source = readFileSync(panelPath, "utf-8");
    expect(source).toContain('data-testid="prospect-continuation-panel"');
    expect(source).toContain("continuePendingReviewAction");
    expect(source).toContain("Continue Review");
  });
});

/* ── Integration: campaign detail page ──────────────────────────── */

describe("campaign continuation UI", () => {
  it("loads pending continuations on the campaign detail page", () => {
    const pagePath = join(SRC_ROOT, "app/dashboard/campaigns/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("listContinuationRequests");
    expect(source).toContain("pendingContinuations");
  });

  it("renders a continuation panel with batch continue button", () => {
    const managerPath = join(SRC_ROOT, "app/dashboard/campaigns/[id]/campaign-detail-manager.tsx");
    const source = readFileSync(managerPath, "utf-8");
    expect(source).toContain('data-testid="campaign-continuation-panel"');
    expect(source).toContain('data-testid="campaign-continue-reviews-button"');
    expect(source).toContain("batchContinuePendingReviewsAction");
    expect(source).toContain("Continue Pending Reviews");
    expect(source).toContain("pendingContinuations");
  });

  it("exports batch continuation action from campaign actions", () => {
    const actionsPath = join(SRC_ROOT, "app/dashboard/campaigns/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function batchContinuePendingReviewsAction");
    expect(source).toContain("isContinuationEligible");
    expect(source).toContain("continuePendingReviewAction");
  });
});
