import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  APPROVAL_EXPIRY_HOURS,
  canResolveApproval,
  getApprovalEffectiveStatus,
  summarizeApprovalRequest,
} from "./approval-model";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("approval schema", () => {
  it("adds approval_requests with expiry and sole-admin policy support", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000015_create_approval_requests.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.approval_requests");
    expect(source).toContain("request_type text not null");
    expect(source).toContain("status text not null default 'pending'");
    expect(source).toContain("expires_at timestamptz");
    expect(source).toContain("create or replace function public.is_sole_admin");
    expect(source).toContain("auth.uid() != requested_by or public.is_sole_admin()");
  });
});

describe("approval helpers", () => {
  it("treats pending requests older than 72 hours as expired", () => {
    expect(APPROVAL_EXPIRY_HOURS).toBe(72);
    expect(getApprovalEffectiveStatus({
      status: "pending",
      expires_at: "2020-01-01T00:00:00.000Z",
    }, new Date("2020-01-05T00:00:00.000Z"))).toBe("expired");
  });

  it("blocks self-approval unless the resolver is the sole admin", () => {
    expect(canResolveApproval({
      requestedBy: "user-1",
      resolverId: "user-1",
      adminCount: 2,
    })).toEqual({ allowed: false, soleAdminFallback: false });

    expect(canResolveApproval({
      requestedBy: "user-1",
      resolverId: "user-1",
      adminCount: 1,
    })).toEqual({ allowed: true, soleAdminFallback: true });
  });

  it("builds readable summaries for approval cards", () => {
    expect(summarizeApprovalRequest({
      id: "req-1",
      request_type: "large_discount",
      status: "pending",
      requested_by: "user-1",
      resolved_by: null,
      context: { quote_number: 12, discount_percent: 30, client_name: "Acme" },
      resolution_note: null,
      expires_at: null,
      resolved_at: null,
      created_at: "",
    })).toContain("Quote #12");
  });
});

describe("approval integration", () => {
  it("adds approval actions and queue UI", () => {
    const actionsPath = join(__dirname, "../app/dashboard/approvals/actions.ts");
    const pagePath = join(__dirname, "../app/dashboard/approvals/page.tsx");
    const uiPath = join(__dirname, "../app/dashboard/approvals/approval-queue-manager.tsx");
    const actionSource = readFileSync(actionsPath, "utf-8");
    const pageSource = readFileSync(pagePath, "utf-8");
    const uiSource = readFileSync(uiPath, "utf-8");
    expect(actionSource).toContain("export async function createApprovalRequestAction");
    expect(actionSource).toContain("export async function listPendingApprovalsAction");
    expect(actionSource).toContain("export async function resolveApprovalRequestAction");
    expect(actionSource).toContain("resolveApprovalRequestRecord");
    expect(pageSource).toContain("ApprovalQueueManager");
    expect(uiSource).toContain('data-testid="approvals-page"');
    expect(uiSource).toContain('data-testid="pending-approvals-list"');
    expect(uiSource).toContain('data-testid="recent-approvals-list"');
  });

  it("resolves approvals with execute-on-approval and stale-context checks", () => {
    const helperPath = join(__dirname, "approval-helpers.ts");
    const source = readFileSync(helperPath, "utf-8");
    expect(source).toContain("executeLargeDiscountApproval");
    expect(source).toContain("executeBatchOutreachApproval");
    expect(source).toContain("executeProjectPurgeApproval");
    expect(source).toContain("Quote subtotal changed after approval was requested.");
    expect(source).toContain("Selected prospects no longer match the original campaign selection.");
    expect(source).toContain("Project slug changed after the purge request was created.");
    expect(source).toContain("Self-approved (sole admin).");
    expect(source).toContain('status: "approved"');
    expect(source).toContain('status: "rejected"');
  });
});
