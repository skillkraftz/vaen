# Roles, Approvals, Campaign Sequencing, Analytics, and Automation Continuation

> Handoff-grade implementation spec for vaen Phase 4.
> Written 2026-03-29.

---

## 0. Current State Summary

What exists today:

| Area | Current state |
|------|--------------|
| Auth | Supabase email/password, single-user model, no roles |
| RLS | All tables enforce `user_id = auth.uid()` ownership |
| Discounts | Hard cap at 25%, reason required, `discount_approved_by` field exists but unused |
| Approvals | None. Outreach send has confirmation checkbox + typed phrase for batch. |
| Campaigns | Container for prospects. Status: draft/active/paused/completed/archived. |
| Sequencing | None. Single outreach send per prospect with `follow_up_count` tracking. 3-day/7-day follow-up timing computed but not acted on. |
| Analytics | Campaign metrics: prospect count, ready count, sent count. No funnel, no conversion tracking. |
| Automation | 5 tiers (convert_only through review_site). Stops at async job boundaries. No auto-continuation. Manual retry via `continueProspectAutomationAction`. |
| Worker comms | DB-mediated: worker writes project status + job status. Portal polls every 3s when job active. No webhooks. |

---

## 1. Product Model

### 1.1 Role Model

Four roles, ordered by escalating privilege:

| Role | Purpose | Who |
|------|---------|-----|
| `viewer` | Read-only access to everything | Clients (future), read-only stakeholders |
| `sales` | Prospect/campaign/outreach + quoting | Sales reps running outbound |
| `operator` | Full project lifecycle + generation + review | Designers, project managers |
| `admin` | Everything including pricing, purge, role management | Agency owner/lead |

**Key design decision:** Roles are **additive**, not exclusive. A user has exactly one role. Higher roles inherit all lower-role permissions. This avoids role-combination complexity.

**Inheritance chain:** `viewer < sales < operator < admin`

### 1.2 Permission Matrix

Actions grouped by minimum required role:

#### viewer (read-only)
- View all projects, clients, prospects, campaigns, quotes, contracts
- View analytics dashboards
- View pricing (but not edit)

#### sales (+ everything viewer can do)
- Create/edit prospects
- Create/edit campaigns
- Run prospect analysis (batch and individual)
- Convert prospects to clients/projects
- Generate outreach packages
- Send outreach (individual, with confirmation)
- Batch send outreach (with typed confirmation)
- Create quotes (discounts 0-10%)
- Transition quotes: draft → sent
- View project detail, revision history

#### operator (+ everything sales can do)
- Run intake processing, approval, export
- Dispatch generate and review jobs
- Edit project request data and revisions
- Run prospect automation at any level
- Apply discounts 11-25% (requires reason, no approval)
- Transition quotes: sent → accepted (creates contract)
- Archive projects
- Edit module selection on projects
- Upload/manage project assets

#### admin (+ everything operator can do)
- Edit pricing settings
- Apply discounts >25% (hard cap at 50%, requires approval record)
- Purge projects (permanent delete)
- Change campaign status to any state
- Manage user roles
- Access approval queue
- Override/force any quote transition
- Delete clients
- Future: deploy projects, manage domains

### 1.3 Approval Gates

Three actions require explicit approval from a higher-privilege user:

| Action | Threshold | Required approver | Current state |
|--------|-----------|-------------------|---------------|
| Large discount | >25% of subtotal | admin | Currently hard-blocked at 25% |
| Batch outreach (>20 recipients) | >20 sends in one batch | operator or admin | Currently only typed confirmation |
| Project purge | Always | admin (cannot self-approve if admin count > 1) | Currently immediate |

**Design decision:** Approvals are lightweight — a single `approval_requests` table. No multi-step approval chains. No escalation trees. An approval request is either pending, approved, or rejected.

### 1.4 Campaign Sequencing Model

Campaigns currently support one-off batch sends. The next stage adds **multi-step sequences** while keeping operator control explicit.

**Sequence model:**

```
Campaign
  └── CampaignSequence (the template for steps)
        ├── Step 1: initial outreach (delay: 0 days)
        ├── Step 2: follow-up (delay: 3 days after step 1)
        └── Step 3: final follow-up (delay: 7 days after step 2)
```

Each prospect in a campaign tracks their position in the sequence:

```
Prospect
  └── prospect_sequence_state
        ├── current_step: 1
        ├── step_1_sent_at: "2026-03-25T..."
        ├── step_1_send_id: "uuid"
        ├── step_2_due_at: "2026-03-28T..."
        ├── step_2_sent_at: null
        └── paused: false
```

**Key constraints:**
- Sequences are defined per-campaign (not global templates yet)
- Maximum 5 steps per sequence
- Each step has: label, delay_days (from prior step), email_subject_template, email_body_template
- Steps execute only when the operator triggers "advance due follow-ups" (semi-automated, not cron)
- Individual prospects can be paused or skipped within a sequence
- A prospect who replies (manually marked `replied`) is automatically paused
- A prospect marked `do_not_contact` is permanently excluded

### 1.5 Analytics Model

Practical campaign analytics, not a BI platform. Three views:

**Campaign Summary (on campaign detail page):**
- Prospect counts by status: new / analyzed / converted / disqualified
- Outreach funnel: drafted / ready / sent / follow-up due / replied / do_not_contact
- Sequence progress: per-step completion counts
- Send metrics: total sent / delivered / failed
- Conversion metrics: quotes created / sent / accepted from campaign prospects

**System Dashboard (new top-level section):**
- Active campaigns count
- Total prospects (all campaigns)
- Outreach sent (last 7 / 30 days)
- Pipeline value: sum of accepted contract values from campaign-sourced prospects
- Follow-ups due today

**Per-Prospect Timeline (on prospect detail):**
Already exists as metadata. Enhanced with sequence step labels and clearer send/fail history.

### 1.6 Automation Continuation Rules

| Boundary | Current | Proposed | Rationale |
|----------|---------|----------|-----------|
| Generate completes → review | Manual | **Auto-continue if prospect automation_level = review_site** | The operator already declared intent at conversion time. Stopping to click "continue" adds friction, not safety. |
| Review completes → outreach package | Manual | **Manual.** Operator must trigger package generation. | Package generation assembles the email. The operator should review screenshots first. |
| Outreach package ready → send | Manual | **Manual.** Always requires confirmation. | Sending email is irreversible. |
| Sequence step due → send | Not implemented | **Semi-auto.** Operator clicks "advance due follow-ups." System sends all due. | Batch follow-ups should be visible and intentional, not invisible background sends. |

**Auto-continuation mechanism:** When a worker job completes, it checks `prospect.metadata.automation_level`. If the next step is within that declared level, the worker writes a `continuation_request` record. The portal displays "N prospects ready for next step" and the operator clicks one button to proceed.

---

## 2. Data Model Additions

### 2.1 User Roles

```sql
-- New column on Supabase auth.users metadata (via admin API)
-- OR: new table for app-level role tracking

CREATE TABLE user_roles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'operator'
               CHECK (role IN ('viewer', 'sales', 'operator', 'admin')),
  granted_by uuid REFERENCES auth.users,
  granted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: admin can read/write all. Others can read own.
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_roles_read ON user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- Admin write policy uses a helper function
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY user_roles_admin_write ON user_roles FOR ALL
  USING (is_admin());
```

**Bootstrap:** First user gets `admin` role automatically. Subsequent users default to `operator`.

**TypeScript type:**
```typescript
export type UserRole = "viewer" | "sales" | "operator" | "admin";

export interface UserRoleRecord {
  user_id: string;
  role: UserRole;
  granted_by: string | null;
  granted_at: string;
  created_at: string;
}
```

### 2.2 Approval Requests

```sql
CREATE TABLE approval_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type  text NOT NULL
                  CHECK (request_type IN (
                    'large_discount', 'batch_outreach', 'project_purge'
                  )),
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_by  uuid NOT NULL REFERENCES auth.users,
  resolved_by   uuid REFERENCES auth.users,
  -- Context payload: varies by request_type
  context       jsonb NOT NULL DEFAULT '{}',
  -- For large_discount: { quote_id, discount_percent, discount_cents, reason }
  -- For batch_outreach: { campaign_id, prospect_count, prospect_ids }
  -- For project_purge: { project_id, project_name, project_slug }
  resolution_note text,
  expires_at    timestamptz,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_requests_status ON approval_requests (status)
  WHERE status = 'pending';
CREATE INDEX idx_approval_requests_requested_by ON approval_requests (requested_by);

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

-- Requesters can see their own. Admins can see all.
CREATE POLICY approval_read ON approval_requests FOR SELECT
  USING (auth.uid() = requested_by OR is_admin());

CREATE POLICY approval_insert ON approval_requests FOR INSERT
  WITH CHECK (auth.uid() = requested_by);

CREATE POLICY approval_resolve ON approval_requests FOR UPDATE
  USING (is_admin() AND auth.uid() != requested_by);
```

**Expiry:** Approval requests expire after 72 hours if not resolved. A simple check at read time: if `status = 'pending'` and `expires_at < now()`, treat as expired.

**TypeScript type:**
```typescript
export type ApprovalRequestType = "large_discount" | "batch_outreach" | "project_purge";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  id: string;
  request_type: ApprovalRequestType;
  status: ApprovalStatus;
  requested_by: string;
  resolved_by: string | null;
  context: Record<string, unknown>;
  resolution_note: string | null;
  expires_at: string | null;
  resolved_at: string | null;
  created_at: string;
}
```

### 2.3 Campaign Sequences

```sql
CREATE TABLE campaign_sequence_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES campaigns ON DELETE CASCADE,
  step_number  integer NOT NULL CHECK (step_number BETWEEN 1 AND 5),
  label        text NOT NULL,
  delay_days   integer NOT NULL DEFAULT 0 CHECK (delay_days >= 0),
  -- Templates: use {{company_name}}, {{contact_name}}, {{offer_summary}}
  subject_template text,
  body_template    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, step_number)
);

CREATE INDEX idx_campaign_steps_campaign ON campaign_sequence_steps (campaign_id);

ALTER TABLE campaign_sequence_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY steps_access ON campaign_sequence_steps FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM campaigns
      WHERE campaigns.id = campaign_sequence_steps.campaign_id
        AND campaigns.user_id = auth.uid()
    )
  );
```

**Per-prospect sequence state** stored in existing `prospects.metadata` jsonb:

```typescript
interface ProspectSequenceState {
  current_step: number;             // 1-indexed, 0 = not started
  steps: Array<{
    step_number: number;
    sent_at: string | null;
    send_id: string | null;         // outreach_sends.id
    due_at: string | null;
    skipped: boolean;
  }>;
  paused: boolean;
  paused_reason: string | null;     // "replied" | "manual" | "do_not_contact"
}
```

**Why metadata instead of a separate table:** Sequence state is tightly coupled to prospect lifecycle and is queried alongside prospect data. A separate table adds join overhead for every prospect list query. The metadata approach matches the existing `automation_progress` pattern.

### 2.4 Continuation Requests

```sql
-- Lightweight table for tracking auto-continuation intent
CREATE TABLE continuation_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id  uuid NOT NULL REFERENCES prospects ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  job_id       uuid NOT NULL REFERENCES jobs,
  next_action  text NOT NULL
                 CHECK (next_action IN ('review', 'generate_package')),
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'completed', 'skipped')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_continuation_pending ON continuation_requests (status)
  WHERE status = 'pending';
CREATE INDEX idx_continuation_prospect ON continuation_requests (prospect_id);

ALTER TABLE continuation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY continuation_access ON continuation_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM prospects
      WHERE prospects.id = continuation_requests.prospect_id
        AND prospects.user_id::uuid = auth.uid()
    )
  );
```

### 2.5 Analytics Materialization

No new tables for basic analytics. All metrics computed via queries on existing tables. Add two indexes to support efficient aggregation:

```sql
-- Fast campaign funnel queries
CREATE INDEX idx_prospects_campaign_status ON prospects (campaign_id, status)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX idx_outreach_sends_campaign_status ON outreach_sends (campaign_id, status)
  WHERE campaign_id IS NOT NULL;

-- Fast follow-up due queries
CREATE INDEX idx_prospects_followup_due ON prospects (next_follow_up_due_at)
  WHERE outreach_status = 'sent' AND next_follow_up_due_at IS NOT NULL;
```

### 2.6 Discount Guardrail Changes

Current behavior: hard block at 25%. No approval path.

New behavior:

| Discount % | Role required | Approval required |
|------------|--------------|-------------------|
| 0-10% | sales | No (reason required) |
| 11-25% | operator | No (reason required) |
| 26-50% | admin | Yes, approval_request with type `large_discount` |
| >50% | Blocked | Not allowed |

Update `validateDiscount()` to accept a role parameter and return an `approval_required` flag instead of hard blocking at 25%.

---

## 3. Recommended UX / Workflow

### 3.1 Role Management UI

**Location:** New page at `/dashboard/settings/team`

**For admin only.** Shows:
- List of users with current roles
- Role selector dropdown per user
- "Invite user" form (email + role) — creates Supabase auth invite
- Cannot demote the last admin

**For non-admins:** The settings page shows their own role as read-only text.

**Permission enforcement pattern in server actions:**

```typescript
// New utility: apps/portal/src/lib/auth-helpers.ts
export async function requireRole(minRole: UserRole): Promise<{
  user: User;
  role: UserRole;
  error?: string;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, role: "viewer", error: "Not authenticated" };

  const { data: roleRecord } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  const role = roleRecord?.role ?? "operator"; // default for existing users
  const hierarchy = ["viewer", "sales", "operator", "admin"];
  const hasPermission = hierarchy.indexOf(role) >= hierarchy.indexOf(minRole);

  if (!hasPermission) {
    return { user, role, error: `Requires ${minRole} role.` };
  }
  return { user, role };
}
```

**Incremental enforcement strategy:** Do NOT retrofit every existing action on day 1. Instead:
1. Add `user_roles` table and `requireRole()` helper
2. Gate only the high-risk actions first: pricing edits, purge, discount >25%, batch outreach >20
3. Gradually add role checks to other actions in subsequent passes
4. Default role for existing users: `operator` (preserves current behavior)

### 3.2 Approval Queue UI

**Location:** New page at `/dashboard/approvals`

**Visible to: admin role.** Shows:
- List of pending approval requests, sorted by created_at desc
- Each card shows: request type, who requested, context summary, "Approve" / "Reject" buttons
- Expired requests shown in a collapsed section

**Inline approval request flow (example: large discount):**

1. Sales user sets discount to 30% on a draft quote
2. Server action returns `{ approval_required: true, request_id: "..." }`
3. Quote UI shows yellow banner: "Discount of 30% requires admin approval. Request submitted."
4. Quote discount field shows the pending value but is not applied yet
5. Admin sees request in `/dashboard/approvals`
6. Admin approves → server action applies the discount and records `discount_approved_by`
7. Sales user's quote refreshes to show applied discount

**For batch outreach (>20):**

1. Operator selects 35 prospects and clicks "Send"
2. Server action returns `{ approval_required: true, request_id: "..." }`
3. Campaign UI shows: "Batch send of 35 emails requires approval. Request submitted."
4. Admin approves → system executes the batch send
5. Results page shown when complete

**For project purge:**

1. Operator clicks "Purge project"
2. Server action creates approval request
3. UI shows: "Purge request submitted for admin review."
4. Admin approves → purge executes

### 3.3 Campaign Sequence Builder UI

**Location:** New section on campaign detail page, between campaign header and prospect list.

**Sequence builder:**

```
┌─────────────────────────────────────────────┐
│ Outreach Sequence                    [Edit] │
│                                             │
│  Step 1: Initial outreach (Day 0)           │
│  Subject: {{company_name}}: website ideas   │
│                                             │
│  Step 2: Follow-up (Day 3)                  │
│  Subject: Re: {{company_name}} website      │
│                                             │
│  Step 3: Final follow-up (Day 10)           │
│  Subject: Last note — {{company_name}}      │
│                                             │
│  [+ Add Step]                               │
└─────────────────────────────────────────────┘
```

**Edit mode:** Inline form per step with subject template, body template, delay_days input.

**Template variables:** `{{company_name}}`, `{{contact_name}}`, `{{website_url}}`, `{{offer_summary}}`, `{{pricing_summary}}`. Rendered at send time using prospect/package data.

**Sequence execution UI (on campaign detail):**

```
┌─────────────────────────────────────────────┐
│ Sequence Progress                           │
│                                             │
│  Step 1: 34 sent / 35 total                │
│  Step 2: 12 sent / 28 due / 6 not yet due  │
│  Step 3: 0 sent / 0 due / 34 not yet due   │
│                                             │
│  [Advance 28 Due Follow-ups]                │
│                                             │
│  Last advanced: 2026-03-28 at 2:15 PM       │
└─────────────────────────────────────────────┘
```

**"Advance Due Follow-ups" button:** Processes all prospects where the current step is due. Uses the step's subject/body template (falling back to the outreach package email if no template is set for that step). Requires typed confirmation if >20 sends.

### 3.4 Campaign Analytics Section

**Location:** New section at top of campaign detail page + new dashboard page.

**Campaign detail analytics (card row above prospect list):**

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Prospects│ │ Analyzed │ │ Converted│ │ Emails   │ │ Replies  │
│    47    │ │    42    │ │    35    │ │    68    │ │     3    │
│          │ │  89.4%   │ │  74.5%   │ │  sent    │ │   4.4%   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

**System analytics page at `/dashboard/analytics`:**

```
Active campaigns: 3
Total pipeline prospects: 142
─────────────────────────────────
Last 7 days         Last 30 days
  Emails sent: 47     Emails sent: 203
  Failed: 2           Failed: 8
  Replies: 5          Replies: 12
─────────────────────────────────
Pipeline value: $14,200 (accepted contracts from campaign prospects)
Follow-ups due today: 12
Approvals pending: 1
```

### 3.5 Automation Continuation UX

**When a generate job completes for a prospect with `automation_level = review_site`:**

1. Worker writes `continuation_requests` record: `{ next_action: "review", status: "pending" }`
2. Worker updates `prospect.metadata.automation_blocked_reason = null`
3. Campaign detail page shows badge: "3 prospects ready for review"
4. Operator clicks "Continue N Pending Reviews" → dispatches review jobs for all pending

**When NOT to auto-continue:**
- If the prospect's campaign is paused → skip, mark continuation as `skipped`
- If the prospect is marked `do_not_contact` → skip
- If the prospect's sequence is paused → skip

**UI indicator on prospect detail:**

```
┌─────────────────────────────────────────────┐
│ Automation Status                           │
│                                             │
│  Level: review_site                         │
│  Progress: ✓ convert ✓ intake ✓ export      │
│            ✓ generate ⏳ review (ready)      │
│                                             │
│  [Continue to Review]                       │
└─────────────────────────────────────────────┘
```

---

## 4. Risk / Edge-Case Analysis

### 4.1 Role System Risks

**Risk: Role bootstrap chicken-and-egg.**
The first user needs admin role, but the `user_roles` table starts empty.
**Mitigation:** Migration seeds the first user as admin. `requireRole()` defaults to `operator` when no role record exists, which preserves current behavior for all existing users.

**Risk: Single admin locks themselves out by changing their own role.**
**Mitigation:** Server action prevents demoting the last admin. UI disables the role dropdown for the last admin user.

**Risk: RLS bypass via service role.**
Worker uses `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS. This is correct — the worker is a trusted system process, not a user action.
**Mitigation:** No change needed. Worker never calls user-facing actions.

### 4.2 Approval System Risks

**Risk: Approval request goes stale.**
**Mitigation:** 72-hour expiry. Expired requests shown with clear "expired" status. The original action can be re-requested.

**Risk: Admin approves their own request.**
**Mitigation:** `approval_resolve` RLS policy prevents `auth.uid() = requested_by`. If there is only one admin, approval is bypassed with an audit note: "Self-approved (sole admin)."

**Risk: Approved action references stale data (e.g., quote was modified after approval requested).**
**Mitigation:** When executing an approved action, re-validate the context. For discounts: re-check that the quote is still draft and subtotal hasn't changed. If stale, reject the approval and ask for a new request.

### 4.3 Campaign Sequencing Risks

**Risk: Duplicate sends — same prospect gets the same step email twice.**
**Mitigation:** Before sending a sequence step, check `prospect_sequence_state.steps[N].sent_at`. If already set, skip. Additionally, the existing `isDuplicateSendBlocked()` 10-minute window still applies.

**Risk: Prospect replies but operator doesn't mark them as replied, so they get follow-up.**
**Mitigation:** This is an operator discipline issue, not solvable in v1 without inbound email parsing. The sequence state UI makes it clear which prospects are still in the active sequence. Future: webhook from Resend for reply detection.

**Risk: Sequence step templates produce bad emails because template variables are missing.**
**Mitigation:** At render time, replace missing variables with empty string and log a warning. Show a preview step before batch send that flags "3 prospects have missing {{contact_name}} — will be sent without personalization."

**Risk: Operator modifies sequence steps after some prospects have already received earlier steps.**
**Mitigation:** Allow editing future steps freely. Past steps (where any prospect has `sent_at` set) are locked. Show badge: "Step 1 is locked (34 sends)."

**Risk: Prospect is in a campaign with a sequence but was sent outreach manually (outside the sequence).**
**Mitigation:** Manual sends do NOT advance the sequence. The prospect's sequence state only advances when sent through the "advance due follow-ups" flow. Manual sends are recorded normally in `outreach_sends` and visible in the prospect timeline. This keeps the two mechanisms independent.

### 4.4 Analytics Risks

**Risk: Analytics queries become slow as data grows.**
**Mitigation:** The proposed indexes cover the primary query patterns. All analytics queries use campaign_id as the leading filter, which keeps scan sizes bounded. No materialized views needed at current scale (<10k prospects).

**Risk: Reply rate is misleading because we only track manually-marked replies.**
**Mitigation:** Label clearly: "Marked as replied" not "Reply rate." Avoids implying automated tracking.

### 4.5 Automation Continuation Risks

**Risk: Worker creates a continuation_request but the portal never sees it (user doesn't visit).**
**Mitigation:** Continuation requests are persistent in the DB. They appear whenever the user visits the campaign page. No TTL — they stay pending until acted on or the campaign is completed/archived.

**Risk: Review job fails after auto-dispatch, and the prospect gets stuck.**
**Mitigation:** Same as today: job failure sets `automation_blocked_reason` in prospect metadata. The campaign page shows "N prospects with blocked automation." Operator can retry.

**Risk: Auto-continuation fires review for 50 prospects simultaneously, overwhelming the worker.**
**Mitigation:** The "Continue N Pending Reviews" button processes sequentially (same pattern as existing batch ops). Worker jobs are spawned one at a time. If concurrency limits are added later, the existing `spawnWorker()` pattern is the natural throttle point.

---

## 5. Implementation Phases

### Phase R1: Role Foundation (Codex-ready, ~1 day)

**What:** Add `user_roles` table, `is_admin()` function, `requireRole()` helper. Bootstrap existing users as `operator`. Seed first user as `admin`.

**Deliverables:**
1. Migration: `user_roles` table with RLS policies and `is_admin()` function
2. `apps/portal/src/lib/auth-helpers.ts`: `requireRole()`, `getUserRole()`, `ROLE_HIERARCHY` constant
3. Seed script: insert `admin` role for current user on migration
4. Update middleware to load role into session context (available in server components)

**Tests:**
- `requireRole()` returns correct error for insufficient role
- `requireRole()` allows exact and higher roles
- `is_admin()` function works through RLS
- Default role is `operator` when no record exists

**Why first:** Every subsequent phase depends on role checks. This is the foundation.

### Phase R2: Gate High-Risk Actions (Codex-ready, ~1 day)

**What:** Add role checks to the most dangerous existing actions.

**Actions to gate:**
1. `updatePricingItemAction` → `requireRole("admin")`
2. `purgeProjectResources` (in `project-lifecycle-helpers.ts`) → `requireRole("admin")`
3. `setQuoteDiscountAction` → role-dependent validation:
   - sales: 0-10% allowed
   - operator: 0-25% allowed
   - admin: 0-50% allowed (>25% creates approval request)
4. `batchSendCampaignOutreachAction` → `requireRole("sales")` + approval request if >20

**Update `validateDiscount()`:**
```typescript
export function validateDiscount(
  discountCents: number,
  subtotalCents: number,
  reason: string | null,
  role: UserRole,
): { valid: boolean; error?: string; percent?: number; approval_required?: boolean }
```

**Tests:**
- Discount at 15% blocked for sales role
- Discount at 30% returns `approval_required` for admin role
- Pricing edit returns error for non-admin
- Purge returns error for non-admin

### Phase A1: Approval System (Codex-ready, ~1.5 days)

**What:** `approval_requests` table + server actions + UI page.

**Deliverables:**
1. Migration: `approval_requests` table with RLS
2. Server actions: `createApprovalRequestAction`, `resolveApprovalRequestAction`, `listPendingApprovalsAction`
3. Execute-on-approval logic: when approval is granted, automatically execute the gated action (apply discount, execute batch send, run purge)
4. New page: `/dashboard/approvals` with pending/resolved list
5. Inline approval status banners in quote section and campaign detail
6. Hook into R2 gates: discount >25% and batch send >20 create approval requests instead of blocking

**Tests:**
- Create approval request, verify pending status
- Resolve as approved, verify action executes
- Resolve as rejected, verify action does not execute
- Verify self-approval blocked (unless sole admin)
- Verify expired request handling
- Verify stale-context re-validation on execute

### Phase S1: Campaign Sequence Model (Codex-ready, ~1 day)

**What:** `campaign_sequence_steps` table + sequence builder UI on campaign detail.

**Deliverables:**
1. Migration: `campaign_sequence_steps` table with RLS
2. Server actions: `upsertCampaignSequenceStepsAction`, `listCampaignSequenceStepsAction`
3. Campaign detail UI: sequence builder section (add/edit/remove steps, reorder)
4. Locked-step detection: steps with sends cannot be edited
5. TypeScript types for `ProspectSequenceState`

**Tests:**
- Create 3-step sequence
- Verify step_number uniqueness constraint
- Verify locked-step detection when sends exist
- Verify max 5 steps enforced

### Phase S2: Sequence Execution (Codex-ready, ~1.5 days)

**What:** "Advance due follow-ups" batch action + per-prospect sequence state tracking.

**Deliverables:**
1. `advanceDueFollowUpsAction(campaignId)`: finds all prospects where current step is due, sends using step template (or falls back to outreach package email), advances `prospect_sequence_state`
2. Prospect sequence state initialization: when first outreach is sent via campaign, initialize sequence state at step 1
3. Template rendering: replace `{{variables}}` with prospect/package data
4. Sequence progress display on campaign detail (per-step counts)
5. Individual prospect sequence state on prospect detail page
6. Pause/skip controls per prospect within sequence

**Duplicate prevention rules:**
- Check `prospect_sequence_state.steps[N].sent_at` before sending
- Existing `isDuplicateSendBlocked()` window still applies
- Prospect marked `replied` or `do_not_contact` → auto-pause sequence

**Tests:**
- Send step 1, verify step_1_sent_at and step_2_due_at computed correctly
- Advance due follow-ups processes only due prospects
- Replied prospect skipped in advance
- Paused prospect skipped
- Template variables rendered correctly
- Missing variables produce clean output (no `{{undefined}}`)

### Phase D1: Campaign Analytics (Codex-ready, ~1 day)

**What:** Analytics queries + UI on campaign detail and new dashboard page.

**Deliverables:**
1. `apps/portal/src/lib/campaign-analytics.ts`: query functions for campaign funnel metrics, send metrics, conversion metrics
2. Updated campaign detail page: analytics card row at top
3. New page: `/dashboard/analytics` with system-wide metrics
4. Indexes: `idx_prospects_campaign_status`, `idx_outreach_sends_campaign_status`, `idx_prospects_followup_due`

**Metrics to compute:**
- Campaign funnel: prospects → analyzed → converted → sent → replied (counts + percentages)
- Send metrics: total / delivered / failed / blocked (from `outreach_sends`)
- Sequence metrics: per-step completion counts
- Pipeline value: sum of `contracts.setup_amount_cents` where project links to campaign prospect
- Follow-ups due: count of prospects where `next_follow_up_due_at <= now` and `outreach_status = 'sent'`

**Tests:**
- Funnel counts correct with mixed prospect statuses
- Pipeline value sums only accepted contracts
- Follow-up due count excludes paused and do_not_contact prospects

### Phase C1: Automation Continuation (Codex-ready, ~1 day)

**What:** `continuation_requests` table + worker writes continuation on job completion + campaign UI shows pending continuations.

**Deliverables:**
1. Migration: `continuation_requests` table with RLS
2. Worker change (`run-job.ts`): after generate job completes successfully, check if prospect has `automation_level = "review_site"`. If so, insert `continuation_requests` record with `next_action = "review"`.
3. `continuePendingReviewsAction(campaignId)`: processes all pending continuation_requests for a campaign, dispatches review jobs
4. Campaign detail UI: badge "N prospects ready for review" + "Continue Pending Reviews" button
5. Prospect detail: automation progress shows "review (ready)" state

**Tests:**
- Generate job completion creates continuation_request when automation_level warrants it
- Continuation not created for lower automation levels
- Continuation skipped if campaign paused
- Continue action dispatches review jobs and marks continuations completed

### Phase R3: Role Management UI + Team Settings (~0.5 day)

**What:** UI for managing roles. Lower priority — can be done last.

**Deliverables:**
1. `/dashboard/settings/team` page (admin only)
2. User list with role dropdowns
3. Invite user form
4. Last-admin protection in UI
5. Non-admin sees own role as read-only

---

## 6. Opinionated Recommendation: Build Order

```
R1 (roles foundation)     ━━━━━━━━ Day 1
    ↓
R2 (gate high-risk)       ━━━━━━━━ Day 2
    ↓
A1 (approval system)      ━━━━━━━━━━━━ Day 3-4
    ↓
S1 (sequence model)       ━━━━━━━━ Day 5
    ↓
S2 (sequence execution)   ━━━━━━━━━━━━ Day 6-7
    ↓
D1 (analytics)            ━━━━━━━━ Day 8
    ↓
C1 (auto-continuation)    ━━━━━━━━ Day 9
    ↓
R3 (team UI)              ━━━━ Day 10
```

**Total estimated engineering: ~10 working days across 8 phases.**

### Why this order:

1. **R1 + R2 first** because every other feature depends on knowing the user's role. The approval system needs roles. The sequence execution needs role checks on batch sends. Analytics page visibility needs roles.

2. **A1 before sequences** because the approval system is a prerequisite for safely executing batch follow-ups (>20 sends). Without approvals, the only protection is typed confirmation — which is fine for v0 but not for a multi-user system.

3. **S1 + S2 together** because the sequence model without execution is useless. These are the highest-leverage features — they turn vaen from "batch email tool" into "outbound campaign system."

4. **D1 after sequences** because the analytics are most valuable when there's sequence data to show. Campaign funnel without sequence step breakdown is just counting statuses.

5. **C1 after sequences** because auto-continuation is a quality-of-life improvement, not a blocker. The current manual flow works. This phase makes campaigns with `review_site` automation feel seamless.

6. **R3 last** because role management UI is admin-only and the first admin can manage roles via the Supabase dashboard until this is built. It's low urgency.

### Codex suitability:

| Phase | Codex suitability | Notes |
|-------|-------------------|-------|
| R1 | High | Straightforward migration + utility function |
| R2 | High | Mechanical: add `requireRole()` calls to existing actions |
| A1 | Medium-High | Clear spec, but execute-on-approval logic needs care |
| S1 | High | CRUD migration + UI, well-defined |
| S2 | Medium | Template rendering, state management, batch execution — needs careful edge case handling |
| D1 | High | Query functions + UI display, no complex logic |
| C1 | Medium | Worker modification requires understanding the job lifecycle |
| R3 | High | Standard settings page UI |

### What to defer:

- **Inbound email parsing / reply detection:** Future feature. Currently replies are manually marked.
- **Global sequence templates:** Sequences are per-campaign for now. Extracting reusable templates adds complexity without clear near-term value.
- **Cron-based auto-advance:** Follow-ups are advanced manually. Cron introduces invisible automation that's harder to debug and breaks the "operator sees everything" principle.
- **Granular per-action permissions:** The 4-role hierarchy covers 95% of cases. Fine-grained permission sets (e.g., "can send outreach but not create quotes") are premature.
- **Multi-org / team isolation:** Stays single-org for now. Multi-tenancy is a different architectural tier.
- **Email delivery webhooks:** Resend supports webhooks for delivery/bounce/open tracking. Valuable but separate from this spec scope.

---

## Appendix A: Migration Dependency Graph

```
R1_user_roles
  └── R2 (gates use requireRole)
        └── A1 (approval uses roles for resolve policy)
              └── S2 (batch advance may trigger approval)

S1_sequence_steps (independent of R1/R2/A1)
  └── S2 (execution needs the model)

D1_analytics_indexes (independent, can run anytime)

C1_continuation_requests (depends on worker understanding)
```

Phases R1→R2→A1 are strictly sequential. S1 can start in parallel with A1 if multiple engineers are available. D1 and C1 are independent of each other and can be parallelized.

## Appendix B: Existing Code Touch Points

| Phase | Files modified |
|-------|---------------|
| R1 | New migration, new `lib/auth-helpers.ts`, `middleware.ts` (load role) |
| R2 | `settings/pricing/actions.ts`, `projects/[id]/actions.ts` (purge, discount), `campaigns/actions.ts` (batch send), `lib/quote-helpers.ts` |
| A1 | New migration, new `lib/approval-helpers.ts`, new `dashboard/approvals/` route, `projects/[id]/quote-section.tsx` (inline banner), `campaigns/[id]/campaign-detail-manager.tsx` (inline banner) |
| S1 | New migration, new campaign detail section in `campaigns/[id]/`, `lib/types.ts` (new types) |
| S2 | `campaigns/actions.ts` (advance action), `lib/outreach-execution.ts` (template rendering), `prospects/actions.ts` (sequence state init), `campaigns/[id]/campaign-detail-manager.tsx` (progress display) |
| D1 | New `lib/campaign-analytics.ts`, new `dashboard/analytics/` route, `campaigns/[id]/campaign-detail-manager.tsx` (analytics row) |
| C1 | New migration, `apps/worker/src/run-job.ts` (write continuation), `campaigns/actions.ts` (continue action), `campaigns/[id]/campaign-detail-manager.tsx` (badge + button) |
| R3 | New `dashboard/settings/team/` route |
