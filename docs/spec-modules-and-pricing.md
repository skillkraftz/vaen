# Modules & Pricing — Implementation Spec

**Status:** Handoff-grade spec, ready for phased Codex implementation
**Date:** 2026-03-29
**Depends on:** Clients, archive/delete, and duplication phases (in progress or complete)

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Module Management — Product Design](#2-module-management--product-design)
3. [Module Management — Data Model](#3-module-management--data-model)
4. [Module Management — UI](#4-module-management--ui)
5. [Module Management — Pipeline Integration](#5-module-management--pipeline-integration)
6. [Pricing & Quotes — Product Design](#6-pricing--quotes--product-design)
7. [Pricing & Quotes — Data Model](#7-pricing--quotes--data-model)
8. [Pricing & Quotes — UI](#8-pricing--quotes--ui)
9. [Staleness & Validation Rules](#9-staleness--validation-rules)
10. [Discount Guardrails](#10-discount-guardrails)
11. [Implementation Phases](#11-implementation-phases)
12. [Edge Cases & Risks](#12-edge-cases--risks)

---

## 1. Current State Analysis

### How Modules Work Today

There are **two separate data paths** for module selection, and they are inconsistent:

**Path A — Revision data (`request_data.preferences.modules`):**
- Intake processor hardcodes `["maps-embed"]` in every draft request
- This field exists in the ClientRequest schema but is **never read by the generator or worker**
- It gets written to `client-request.json` on disk during export/generate
- The generator CLI ignores `preferences.modules` in the JSON — it only reads `--modules` from CLI args

**Path B — Project recommendations (`project.recommendations.modules`):**
- Intake processor builds recommendations based on keyword analysis of notes
- Stored as `{id, reason}[]` on `projects.recommendations`
- The **worker reads this field** to build the `--modules` CLI arg: `rec?.modules?.map(m => m.id) ?? ["maps-embed"]`
- This is what actually controls which modules get built

**The problem:** An operator cannot change module selection after intake processing. The recommendations are written once and never updated through the UI. The `request_data.preferences.modules` field is a dead letter — writing to it has no effect on generation.

### What Exists in Code

| Component | Location | Status |
|-----------|----------|--------|
| Module manifests | `packages/module-registry/src/manifests/` | 4 modules defined |
| ModuleManifest type | `packages/module-registry/src/types.ts` | Complete |
| Registry API | `packages/module-registry/src/index.ts` | `getModule`, `listModules`, `getModulesForTemplate` |
| Generator module resolution | `packages/generator/src/resolve-config.ts` | Maps module IDs → config objects |
| Generator CLI `--modules` arg | `packages/generator/src/cli.ts` | Comma-separated module IDs |
| Worker module dispatch | `apps/worker/src/run-job.ts:845` | Reads `project.recommendations.modules` |
| Recommendations display | `apps/portal/.../page.tsx` | Read-only table |
| ClientRequest schema | `packages/schemas/src/client-request.ts` | `preferences.modules: string[]` |
| package_pricing table | — | Does not exist yet |
| quotes / quote_lines / contracts | — | Do not exist yet |

---

## 2. Module Management — Product Design

### Design Principle

**Modules are a project-level selection.** The operator picks which modules a project includes. Module changes create new revisions. The existing staleness system handles "rebuild needed" notifications. No new state machine states.

### Reconciling the Dual Data Path

**Decision: make `project.recommendations.modules` the authoritative source.**

Rationale:
- The worker already reads it
- It is a simple `{id, reason}[]` array on the project row — fast to read, no join needed
- `request_data.preferences.modules` is dead code in the pipeline; we should not build on it
- The recommendations field is project-level, which is the right granularity (not revision-level)

**However**, module changes should also be recorded as revision events for audit trail. When the operator changes modules, we:
1. Update `projects.recommendations.modules` (the authoritative source the worker reads)
2. Create a new revision with the updated `request_data.preferences.modules` (for consistency — the JSON on disk will match)
3. Log a project event

This means both paths stay in sync, but the worker still reads from the same place it always has.

### Operator Workflow

**Viewing modules:**
1. Project detail → Website Plan section → "Modules" subsection (replaces the current read-only Recommendations table)
2. Shows the selected template (read-only) and a list of available modules as toggle cards

**Adding a module:**
1. Operator sees available modules listed as cards with name, description, status badge
2. Each card has an "Add" / "Active" toggle
3. Operator clicks "Add" on booking-lite
4. If the module has required config (e.g., `embedUrl` for booking-lite), a config form appears inline
5. Operator fills required config, clicks "Save Changes"
6. Server action: updates `projects.recommendations`, creates new revision, logs event
7. Staleness system: "Website Built: Outdated — rebuild needed" appears
8. Next Step banner: "Module selection changed — rebuild to apply"

**Removing a module:**
1. Operator clicks the toggle on an active module to deactivate it
2. Confirmation inline: "Remove Maps Embed? The site will be rebuilt without it."
3. Operator confirms
4. Same server action flow: update recommendations, new revision, event

**Configuring a module:**
1. Active modules with configurable options show a "Configure" expansion
2. Config fields are derived from `ModuleManifest.configSchema`
3. Saving config creates a new revision (config is stored in the revision's request_data)

**When modules can be changed:**
- Any time after intake processing (status >= `intake_draft_ready`)
- Changing modules while a job is running is allowed (the change applies to the next build, not the current one)
- No status transition triggered — only a new revision + staleness

---

## 3. Module Management — Data Model

### No new tables needed for module management alone.

Module selection lives on `projects.recommendations.modules[]` (already exists). Module metadata lives in `packages/module-registry` (already exists).

### New column: `projects.selected_modules`

Wait — actually, I want to separate "AI recommendations" from "operator selections." The recommendations field currently stores what the intake processor suggested, with reasons. The operator's actual choices should be a separate field.

```sql
alter table projects
  add column selected_modules jsonb not null default '[]';

comment on column projects.selected_modules is
  'Operator-confirmed module selections. Array of {id, config?} objects. '
  'This is the authoritative source for which modules the generator should use.';
```

Shape: `Array<{ id: string; config?: Record<string, unknown> }>`

Example:
```json
[
  { "id": "maps-embed" },
  { "id": "booking-lite", "config": { "provider": "calendly", "embedUrl": "https://calendly.com/acme" } },
  { "id": "manual-testimonials" }
]
```

### Why a new column instead of reusing recommendations

- `recommendations` is what the AI suggested with reasons — it should remain as-is for audit/reference
- `selected_modules` is what the operator confirmed — it can differ from recommendations
- Keeps the intake processor's output clean (it writes recommendations; it never writes selected_modules)
- Initialization: when intake is processed, `selected_modules` is seeded from the recommended module IDs

### Worker Change

One-line change in `apps/worker/src/run-job.ts`:

```typescript
// Before:
const moduleIds = rec?.modules?.map((m) => m.id) ?? ["maps-embed"];

// After:
const selectedModules = (project.selected_modules ?? []) as Array<{ id: string }>;
const moduleIds = selectedModules.length > 0
  ? selectedModules.map((m) => m.id)
  : rec?.modules?.map((m) => m.id) ?? ["maps-embed"];
```

This is backwards-compatible: existing projects without `selected_modules` fall back to recommendations.

### TypeScript Types

Add to `apps/portal/src/lib/types.ts`:

```typescript
export interface SelectedModule {
  id: string;
  config?: Record<string, unknown>;
}
```

Add to `Project` interface:

```typescript
selected_modules: SelectedModule[];
```

---

## 4. Module Management — UI

### Location: Website Plan Section

Replace the current read-only Recommendations table in `page.tsx` with a new `ModuleManager` client component.

### Layout

```
┌─ Website Plan ──────────────────────────────────────────────┐
│                                                             │
│  Template: service-core                                     │
│  "Best fit for local service businesses"                    │
│                                                             │
│  ── Modules ────────────────────────────────────────────    │
│                                                             │
│  ┌─ Maps Embed ──────────────────────── [Active ✓] ────┐   │
│  │  Google Maps iframe showing business location        │   │
│  │  Status: active                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Manual Testimonials ─────────────── [Active ✓] ────┐   │
│  │  Static testimonials from intake data                │   │
│  │  Status: active                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Booking Lite ────────────────────── [  Add  ] ─────┐   │
│  │  Booking/scheduling embed (Calendly, Cal.com)        │   │
│  │  Status: draft                                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Google Reviews Live ─────────────── [  Add  ] ─────┐   │
│  │  Live Google Reviews via Places API                  │   │
│  │  Status: draft                                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  AI Recommendations:                                        │
│  "maps-embed — Local business benefit from..."              │
│  "manual-testimonials — Notes mention reviews"              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Component: `ModuleManager`

```
File: apps/portal/src/app/dashboard/projects/[id]/module-manager.tsx
Type: "use client"
Props: { projectId: string; templateId: string; selectedModules: SelectedModule[]; recommendations: IntakeRecommendations | null }
```

**Behavior:**
1. On mount: calls `listModulesForTemplate(templateId)` (new server action wrapping the registry)
2. Renders each module as a card with toggle button
3. Active modules (in `selectedModules`) show as toggled on
4. Clicking a toggle calls `updateModulesAction(projectId, newModulesList)`
5. If module has required config and is being added, expand inline config form before saving
6. After save: page revalidates (router.refresh)

### Module Config Form

For modules with `configSchema.required` fields, show an inline form when activating:

```
┌─ Booking Lite ────────────────────── [Active ✓] ─────┐
│  Booking/scheduling embed (Calendly, Cal.com)         │
│                                                       │
│  Provider*:  [Calendly        ▾]                      │
│  Embed URL*: [https://calendly.com/acme___________]   │
│  Button Text: [Book Now________________________]      │
│                                                       │
│  [Save Config]                                        │
└───────────────────────────────────────────────────────┘
```

Config field types are inferred from manifests:
- `configSchema.required` → rendered with asterisk, validated before save
- `configSchema.optional` → rendered without asterisk

For V1: all config fields are text inputs. Enum support (like `provider: calendly | cal.com`) can be added later.

### Server Action: `updateModulesAction`

```typescript
export async function updateModulesAction(
  projectId: string,
  modules: SelectedModule[],
): Promise<{ error?: string }> {
  // 1. Validate module IDs against registry
  // 2. Validate required config fields for each module
  // 3. Update projects.selected_modules
  // 4. Read current revision's request_data
  // 5. Update request_data.preferences.modules to match
  // 6. Create new revision with source = "user_edit"
  // 7. Log project_event: "modules_updated"
  // 8. revalidatePath
}
```

### Test IDs

- `data-testid="module-manager"` — container
- `data-testid="module-card-{id}"` — each module card
- `data-testid="module-toggle-{id}"` — toggle button per module
- `data-testid="module-config-{id}"` — config form per module
- `data-testid="module-save"` — save button

---

## 5. Module Management — Pipeline Integration

### Initialization (during intake processing)

When `processIntakeAction` runs:
1. Intake processor generates `recommendations` (unchanged)
2. New step: seed `selected_modules` from `recommendations.modules`:
   ```typescript
   const selectedModules = recommendations.modules.map(m => ({ id: m.id }));
   await supabase.from("projects").update({ selected_modules: selectedModules }).eq("id", projectId);
   ```
3. Also update `draft_request.preferences.modules` to match (unchanged behavior)

### Generation (worker)

The worker change is one line (see section 3). `selected_modules` is the authority; falls back to `recommendations.modules`.

### Export (generateSiteAction in portal)

When the portal writes `client-request.json`, it should also write `preferences.modules` from `selected_modules`:

```typescript
// In generateSiteAction, after reading revision data:
const selectedModules = (p.selected_modules ?? []) as SelectedModule[];
if (selectedModules.length > 0) {
  const prefs = (revisionData.preferences ?? {}) as Record<string, unknown>;
  prefs.modules = selectedModules.map(m => m.id);
  revisionData.preferences = prefs;
}
```

This keeps the JSON on disk consistent with what the worker will use.

### Module Config Passing

Currently, `resolve-config.ts` derives module config from ClientRequest fields (e.g., `contact.address` for maps-embed). For modules with operator-provided config (like booking-lite's `embedUrl`), we need a new data path.

**Approach:** Store module config in `request_data.preferences.moduleConfig`:

```json
{
  "preferences": {
    "template": "service-core",
    "modules": ["maps-embed", "booking-lite"],
    "moduleConfig": {
      "booking-lite": {
        "provider": "calendly",
        "embedUrl": "https://calendly.com/acme"
      }
    }
  }
}
```

**Generator change** in `resolve-config.ts`:

```typescript
const moduleConfigs = moduleIds.map((id) => {
  // Start with operator-provided config from preferences.moduleConfig
  const operatorConfig = (request.preferences?.moduleConfig?.[id] ?? {}) as Record<string, unknown>;
  const config: Record<string, unknown> = { ...operatorConfig };

  // Layer in auto-derived config (existing logic)
  if (id === "maps-embed" && formattedAddress && !config.address) {
    config.address = formattedAddress;
    config.enabled = true;
  }
  if (id === "manual-testimonials" && !config.testimonials) {
    config.testimonials = siteConfig.testimonials;
    config.enabled = true;
  }

  config.enabled = true;
  return { id, version: "0.1.0", config };
});
```

Operator config takes precedence; auto-derived config fills gaps.

---

## 6. Pricing & Quotes — Product Design

### Pricing Structure

```
Quote Total = Template Base Price
            + Sum(Module Prices)
            + Sum(Add-on Line Items)
            - Discount
```

Every quote is a **snapshot**: it records the exact template, modules, and prices at the time of creation. Later module changes don't retroactively alter existing quotes. Instead, a "Quote may be outdated" badge appears.

### Pricing Tiers

Templates and modules each have two price components:

| Component | Meaning |
|-----------|---------|
| `setup_price_cents` | One-time build/setup fee |
| `recurring_price_cents` | Monthly maintenance/hosting fee |

A quote captures both. Contracts specify billing type (one-time, monthly, annual).

### Operator Workflow

**Creating a quote:**
1. Project detail → Quote section (new, between Website Plan and Business Details)
2. "Create Quote" button
3. System auto-populates:
   - One line for the template (e.g., "Service Core Website — $1,500 setup + $99/mo")
   - One line per selected module (e.g., "Maps Embed — $0 setup + $0/mo", "Booking Lite — $200 setup + $25/mo")
4. Operator can:
   - Edit prices on any line
   - Add custom line items (label, price)
   - Add a discount (amount + reason)
5. "Save as Draft" or "Mark as Sent"

**Managing quotes:**
- A project can have multiple quotes (comparison, revisions)
- Only one can be "accepted" (becomes a contract)
- Quote statuses: `draft → sent → accepted | rejected | expired`

**Accepting a quote:**
1. Operator clicks "Accept" on a sent quote
2. Confirmation: "This will create a contract for $X. Continue?"
3. Contract created with billing terms
4. Quote status → accepted
5. Other sent/draft quotes for this project → expired

**Quote outdated detection:**
- Quote stores `revision_id` and `selected_modules_snapshot`
- If current `selected_modules` differs from the snapshot: badge appears
- Operator can create a new quote at any time

---

## 7. Pricing & Quotes — Data Model

### `package_pricing`

Reference/seed table for default prices. Admin-managed, not user-facing via RLS.

```sql
create table package_pricing (
  id text primary key,
  item_type text not null check (item_type in ('template', 'module')),
  label text not null,
  description text,
  setup_price_cents integer not null default 0,
  recurring_price_cents integer not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed data
insert into package_pricing (id, item_type, label, description, setup_price_cents, recurring_price_cents, sort_order) values
  ('service-core',          'template', 'Service Core Website',    'Standard local service business website',            150000, 9900, 1),
  ('service-area',          'template', 'Service Area Website',    'Multi-location / wide service area website',         200000, 12900, 2),
  ('authority',             'template', 'Authority Website',       'Professional services (legal, medical, financial)',   250000, 14900, 3),
  ('maps-embed',            'module',   'Maps Embed',              'Google Maps showing business location',              0,      0,     10),
  ('manual-testimonials',   'module',   'Testimonials',            'Static testimonials section',                        0,      0,     11),
  ('booking-lite',          'module',   'Online Booking',          'Calendly / Cal.com embed',                          20000,  2500,  12),
  ('google-reviews-live',   'module',   'Live Google Reviews',     'Google Reviews feed via Places API',                15000,  1500,  13);
```

Prices are in cents. `$1,500.00 setup` = `150000`. `$99.00/mo` = `9900`.

No RLS — this is read by server actions, not exposed to client directly.

### `quotes`

```sql
create table quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  quote_number serial,
  revision_id uuid references project_request_revisions(id) on delete set null,
  template_id text not null,
  selected_modules_snapshot jsonb not null default '[]',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  setup_subtotal_cents integer not null default 0,
  recurring_subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  discount_percent numeric(5,2),
  discount_reason text,
  discount_approved_by text,
  setup_total_cents integer not null default 0,
  recurring_total_cents integer not null default 0,
  valid_days integer not null default 30,
  valid_until timestamptz,
  client_name text,
  client_email text,
  notes text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_quotes_project on quotes(project_id);

alter table quotes enable row level security;
create policy "Users manage quotes via project ownership"
  on quotes for all using (
    exists (select 1 from projects p where p.id = quotes.project_id and p.user_id = auth.uid())
  );
```

Key fields:
- `quote_number`: auto-incrementing for display (Quote #1, #2, etc.)
- `selected_modules_snapshot`: frozen copy of `project.selected_modules` at quote creation time
- `discount_percent`: stored alongside `discount_cents` for auditability (you can verify: cents = percent * subtotal)
- `discount_approved_by`: who approved if over the threshold
- `valid_until`: computed from `created_at + valid_days` on insert (trigger or app logic)
- `client_name`, `client_email`: denormalized from client for the quote document

### `quote_lines`

```sql
create table quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  line_type text not null
    check (line_type in ('template', 'module', 'addon', 'discount')),
  reference_id text,
  label text not null,
  description text,
  setup_price_cents integer not null default 0,
  recurring_price_cents integer not null default 0,
  quantity integer not null default 1,
  sort_order integer not null default 0
);

create index idx_quote_lines_quote on quote_lines(quote_id);

alter table quote_lines enable row level security;
create policy "Users manage quote_lines via project ownership"
  on quote_lines for all using (
    exists (
      select 1 from quotes q
      join projects p on p.id = q.project_id
      where q.id = quote_lines.quote_id and p.user_id = auth.uid()
    )
  );
```

Line types:
- `template`: one row, the base template price
- `module`: one row per selected module
- `addon`: operator-added custom line (e.g., "Rush delivery", "Extra pages")
- `discount`: negative-value line(s) for itemized discounts (alternative to the header-level discount; the system supports both patterns — use header-level for simple percentage discounts, line-level for specific itemized discounts like "First project discount")

### `contracts`

```sql
create table contracts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references quotes(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  contract_number serial,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  billing_type text not null default 'one_time'
    check (billing_type in ('one_time', 'monthly', 'annual')),
  setup_amount_cents integer not null,
  recurring_amount_cents integer not null default 0,
  started_at timestamptz not null default now(),
  renewal_at timestamptz,
  notes text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_contracts_project on contracts(project_id);
create index idx_contracts_client on contracts(client_id);

alter table contracts enable row level security;
create policy "Users manage contracts via project ownership"
  on contracts for all using (
    exists (select 1 from projects p where p.id = contracts.project_id and p.user_id = auth.uid())
  );
```

### Entity Relationship Summary

```
package_pricing (seed data, no FK)
    ↕ (referenced by label/id during quote creation)

project
  └── selected_modules (jsonb, authoritative module list)
  └── quotes[]
        ├── quote_lines[]
        └── contract (0 or 1, via accepted quote)
```

---

## 8. Pricing & Quotes — UI

### Quote Section Location

New section on the project detail page, **between Website Plan and Business Details**:

```
Header + Progress
WorkflowPanel (NextStep, Preview, Status, Advanced)
Website Plan (Modules, Summary, Recommendations, Missing Info)
─── Quote ───                    ← NEW
Business Details
Files & Images
History & Diagnostics (collapsed)
```

### Quote Section — No Quote State

```
┌─ Quote ──────────────────────────────────────────────┐
│                                                      │
│  No quote created yet.                               │
│                                                      │
│  [Create Quote]                                      │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Quote Section — Draft Quote

```
┌─ Quote #1 ──────────────────────── [Draft] ─────────┐
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ Item                    Setup     Monthly      │  │
│  │ ──────────────────────────────────────────     │  │
│  │ Service Core Website    $1,500    $99/mo       │  │
│  │ Maps Embed              $0        $0           │  │
│  │ Online Booking          $200      $25/mo       │  │
│  │ + Add line item                                │  │
│  │ ──────────────────────────────────────────     │  │
│  │ Subtotal                $1,700    $124/mo      │  │
│  │ Discount (10%)          -$170                  │  │
│  │   Reason: First project with agency            │  │
│  │ ──────────────────────────────────────────     │  │
│  │ TOTAL                   $1,530    $124/mo      │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Valid for 30 days                                   │
│                                                      │
│  [Mark as Sent]  [Delete Draft]                      │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Quote Section — Sent Quote

```
┌─ Quote #1 ──────────────────────── [Sent] ──────────┐
│                                                      │
│  (same line items table, read-only)                  │
│                                                      │
│  Sent Mar 29 · Valid until Apr 28                    │
│                                                      │
│  [Accept]  [Reject]                                  │
│                                                      │
│  ⚠ Module selection has changed since this quote     │
│    was created. Consider creating a new quote.       │
│                                                      │
└──────────────────────────────────────────────────────┘
```

The warning appears when `project.selected_modules` differs from `quote.selected_modules_snapshot`.

### Quote Section — Accepted (Contract Active)

```
┌─ Quote #1 ──────────────────── [Accepted ✓] ────────┐
│                                                      │
│  (line items, read-only)                             │
│                                                      │
│  Contract #1 · Active · Monthly billing              │
│  Setup: $1,530 · Recurring: $124/mo                  │
│  Started Mar 29 · Renewal Apr 29                     │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Quote History

If a project has multiple quotes, show the active/latest prominently, with older ones in a collapsible "Previous Quotes" list:

```
▸ Previous Quotes (2)
    Quote #1 — $1,530 — Rejected Mar 25
    Quote #2 — $1,700 — Expired Mar 28
```

### Editing Line Items

When a quote is in `draft` status, each line item is editable:
- Click on a price → inline number input
- Click on label/description → inline text input
- "Add line item" link at bottom of table → adds an `addon` row
- Delete button (x) on addon rows only (template and module lines can't be deleted, only zeroed)

### Component Structure

```
File: apps/portal/src/app/dashboard/projects/[id]/quote-section.tsx
Type: "use client"

Components:
  QuoteSection         — container, fetches quotes for project
  QuoteCard            — displays one quote with status badge
  QuoteLineItemsTable  — editable line items table
  QuoteActions         — status transition buttons
  QuoteSummary         — totals + discount display
  ContractBadge        — shows contract info if accepted
  CreateQuoteBtn       — auto-populates from pricing + modules
```

### Server Actions

```typescript
// In actions.ts or a new quote-actions.ts

createQuoteAction(projectId: string)
  // 1. Read project.selected_modules + template from recommendations
  // 2. Look up package_pricing for each
  // 3. Create quote + quote_lines
  // 4. Set quote.selected_modules_snapshot = project.selected_modules
  // 5. Set quote.revision_id = project.current_revision_id
  // Return quote ID

updateQuoteLineAction(lineId: string, updates: { setup_price_cents?, recurring_price_cents?, label?, description? })
  // Only allowed for draft quotes
  // Recalculate quote totals after update

addQuoteLineAction(quoteId: string, line: { label, description?, setup_price_cents, recurring_price_cents })
  // Add addon line, recalculate totals

removeQuoteLineAction(lineId: string)
  // Only for addon lines on draft quotes

setQuoteDiscountAction(quoteId: string, discount: { percent?: number; cents?: number; reason: string })
  // Apply discount, validate against guardrails

transitionQuoteAction(quoteId: string, newStatus: 'sent' | 'accepted' | 'rejected')
  // Validate transition
  // If accepted: create contract, expire other quotes
  // Log project_event
```

### Test IDs

- `data-testid="quote-section"` — container
- `data-testid="quote-card-{id}"` — each quote
- `data-testid="quote-status-{status}"` — status badge
- `data-testid="quote-line-{id}"` — each line item row
- `data-testid="quote-total-setup"` — setup total
- `data-testid="quote-total-recurring"` — recurring total
- `data-testid="quote-discount"` — discount row
- `data-testid="quote-outdated-warning"` — module mismatch warning
- `data-testid="btn-create-quote"` — create button
- `data-testid="btn-accept-quote"` — accept button
- `data-testid="contract-badge"` — contract display

---

## 9. Staleness & Validation Rules

### Module Change → Revision Staleness (existing system, no changes)

| Event | Effect |
|-------|--------|
| Operator changes modules | New revision created |
| `current_revision_id` changes | All revision pointers become stale |
| `last_exported != current` | "Content Prepared: Outdated" |
| `last_generated != current` | "Website Built: Outdated — rebuild needed" |
| `last_reviewed != current` | "Preview: Outdated" |

The Next Step banner already shows appropriate rebuild prompts when staleness is detected.

### Module Change → Quote Outdated (new)

| Condition | Display |
|-----------|---------|
| `quote.selected_modules_snapshot` === `project.selected_modules` | No warning |
| They differ | Warning badge: "Module selection has changed since this quote was created" |
| Quote is `draft` | Warning + "Update Quote" button (re-generates lines from current modules) |
| Quote is `sent` | Warning only (can't edit a sent quote — create new one) |
| Quote is `accepted` | Warning on contract display |

**Comparison logic:** JSON comparison of the `id` arrays, order-insensitive. Config differences do NOT trigger the warning (config changes don't affect pricing).

### Quote Validity

| Condition | Effect |
|-----------|--------|
| `now() > quote.valid_until` | Auto-expired on next load (or background job) |
| Quote expired | Status → `expired`, no longer actionable |
| Quote accepted | Other quotes for same project → `expired` |
| Project archived | Quotes remain but are not actionable |
| Project deleted | Quotes cascade-deleted |

### Discount Validation (on save)

| Rule | Enforcement |
|------|-------------|
| Discount ≤ 25% of setup subtotal | Soft limit: allow with required reason |
| Discount > 25% of setup subtotal | Hard block in V1; approval workflow in V2 |
| Discount reason required for any discount > $0 | Enforced in server action |
| Discount cannot exceed subtotal | `discount_cents ≤ setup_subtotal_cents` |
| Recurring discount | Not supported in V1 (recurring prices are fixed) |

---

## 10. Discount Guardrails

### Tiers

| Discount Range | Requirement |
|----------------|-------------|
| 0% | None |
| 1–10% | Reason required |
| 11–25% | Reason required |
| 26–50% | Blocked in V1. V2: requires approval from account owner |
| 51–100% | Blocked. Not allowed. |

### Implementation

```typescript
function validateDiscount(
  discountCents: number,
  subtotalCents: number,
  reason: string | null,
): { valid: boolean; error?: string } {
  if (discountCents < 0) return { valid: false, error: "Discount cannot be negative" };
  if (discountCents > subtotalCents) return { valid: false, error: "Discount cannot exceed subtotal" };
  if (subtotalCents === 0) return { valid: true };

  const percent = (discountCents / subtotalCents) * 100;

  if (percent > 25) {
    return { valid: false, error: `Discount of ${percent.toFixed(0)}% exceeds maximum allowed (25%). Contact account owner for exceptions.` };
  }

  if (discountCents > 0 && (!reason || reason.trim().length < 3)) {
    return { valid: false, error: "A reason is required for discounts" };
  }

  return { valid: true };
}
```

### Audit Trail

Every discount is logged in `project_events`:

```json
{
  "event_type": "quote_discount_applied",
  "metadata": {
    "quote_id": "...",
    "discount_cents": 17000,
    "discount_percent": 10,
    "reason": "First project with agency",
    "applied_by": "user_id"
  }
}
```

---

## 11. Implementation Phases

### Phase M1: Module Management Foundation (1 day)

**Migration:**
- Add `projects.selected_modules` column (jsonb, default `[]`)

**Backend:**
- `updateModulesAction` server action
- `listAvailableModulesAction` server action (reads module-registry, filters by template compatibility)
- Seed `selected_modules` during `processIntakeAction` from recommendations
- Update worker to read `selected_modules` with fallback to `recommendations.modules`

**Tests:**
- Unit test: `updateModulesAction` creates new revision
- Unit test: worker reads `selected_modules` correctly
- Unit test: fallback to recommendations when `selected_modules` is empty

**Codex-suitable:** Yes. Well-defined inputs/outputs. The migration and server actions are mechanical. The worker change is one line with a fallback.

### Phase M2: Module Management UI (1 day)

**Components:**
- `ModuleManager` client component
- Module cards with toggle
- Integration with page.tsx (replace Recommendations table)

**No config forms yet.** Modules are toggled on/off; config comes in M3.

**Codex-suitable:** Yes. Straightforward React component. Toggle + server action + revalidate.

### Phase M3: Module Config UI (0.5 day)

**Components:**
- Inline config form per module (when module has `configSchema.required`)
- Config stored in `selected_modules[].config` and `request_data.preferences.moduleConfig`

**Generator change:**
- `resolve-config.ts` reads `preferences.moduleConfig` for operator-provided values

**Codex-suitable:** Partially. The UI is simple. The generator change needs careful review to ensure operator config doesn't break existing auto-derived config.

### Phase P1: Pricing Seed Data + Data Model (0.5 day)

**Migrations:**
- `package_pricing` table + seed data
- `quotes` table
- `quote_lines` table
- `contracts` table

**Types:**
- `Quote`, `QuoteLine`, `Contract`, `PackagePricing` interfaces in types.ts

**Codex-suitable:** Yes. Pure SQL migrations and TypeScript types.

### Phase P2: Quote Creation + Display (1.5 days)

**Backend:**
- `createQuoteAction` — auto-populates from pricing table + selected modules
- `updateQuoteLineAction` — edit individual line items
- `addQuoteLineAction` / `removeQuoteLineAction` — addon lines
- `setQuoteDiscountAction` — with guardrails
- `getQuotesForProjectAction` — list quotes

**UI:**
- `QuoteSection` on project detail page
- `QuoteCard` with line items table
- Create button
- Inline editing for draft quotes
- Discount input with reason field

**Codex-suitable:** Mostly. The CRUD is mechanical. The discount validation and totals recalculation need the exact guardrail logic from this spec.

### Phase P3: Quote Lifecycle + Contracts (1 day)

**Backend:**
- `transitionQuoteAction` — draft→sent→accepted/rejected
- Contract creation from accepted quote
- Auto-expire other quotes on acceptance
- Quote outdated detection (compare snapshots)

**UI:**
- Status badges on quotes
- Accept/Reject buttons
- Contract display badge
- "Quote outdated" warning
- Previous quotes collapsible

**Codex-suitable:** Yes. State machine is simple. Contract creation is a single insert.

### Phase P4: Quote Refresh + Polish (0.5 day)

**Features:**
- "Update Quote" button on outdated draft quotes (re-generates lines from current modules/pricing)
- Validity countdown display
- Auto-expire on load for past-valid-until quotes
- Quote/contract info in project event audit trail

**Codex-suitable:** Yes.

### Total Estimated Effort

| Phase | Effort |
|-------|--------|
| M1: Module foundation | 1 day |
| M2: Module UI | 1 day |
| M3: Module config | 0.5 day |
| P1: Pricing data model | 0.5 day |
| P2: Quote creation + display | 1.5 days |
| P3: Quote lifecycle + contracts | 1 day |
| P4: Quote polish | 0.5 day |
| **Total** | **~6 days** |

### Recommended Build Order

```
M1 → M2 → P1 → P2 → M3 → P3 → P4
```

Rationale:
- M1+M2 deliver standalone value (operators can manage modules immediately)
- P1 is just migrations — do it while M2 UI is fresh for testing
- P2 is the big UI piece — quote creation depends on modules being selectable
- M3 is module config — nice to have before P3 so quotes can include config-dependent modules
- P3+P4 complete the quote lifecycle

---

## 12. Edge Cases & Risks

### Module removal after build

**Scenario:** Operator removes `booking-lite` after site was built with it.
**What happens:**
- New revision created → staleness kicks in
- "Rebuild needed" banner appears
- Next build generates site without booking-lite
- Generator already handles this: modules not in the `--modules` arg are not overlaid
- The booking page/component simply won't exist in the new build
**Risk level:** Low. The generator is already designed for this.

### Module added that needs config but config not provided

**Scenario:** Operator adds `booking-lite` but doesn't fill in `embedUrl`.
**Mitigation:**
- UI requires config before saving (required fields from `configSchema.required`)
- If somehow saved without config: generator receives the module ID but config is empty
- `resolve-config.ts` produces a module entry with empty config
- The generated component should handle missing config gracefully (show "Configuration needed" placeholder)
**Risk level:** Low with UI validation; very low if generator handles empty config.

### Quote created, then template changes

**Scenario:** Operator somehow changes from `service-core` to `authority` after quote creation.
**Current design:** Template is read-only in the UI. Template change is not a supported operator action — it requires re-processing intake with different business type analysis.
**If it happens anyway:** The quote has `template_id` frozen. The `selected_modules_snapshot` diff will catch it if module compatibility changes.
**Risk level:** Very low. Template changes are rare and intentional.

### Discount cents vs percent rounding

**Scenario:** Operator enters 15% discount on $1,700 subtotal = $255.00. But 15% * 170000 = 25500 cents exactly. Clean.
**But:** 7% of $1,500 = $105.00. 7% * 150000 = 10500 cents. Also clean.
**Problem case:** 33% of $1,700 = $561.00. But 33% * 170000 = 56100. The system blocks >25% anyway.
**Mitigation:** Always store both `discount_percent` and `discount_cents`. Compute cents from percent on the server: `Math.round(subtotal * percent / 100)`. Display rounds to whole dollars.
**Risk level:** None if we compute server-side.

### Multiple operators editing the same project

**Scenario:** Two operators both change modules simultaneously.
**Mitigation:** `updateModulesAction` reads current state and writes the full new list. Last write wins. The revision trail preserves both changes as separate revision records. This is acceptable for an internal tool with low concurrent editing.
**Risk level:** Low. Acceptable tradeoff for internal tool.

### Package pricing changes after quotes exist

**Scenario:** Admin changes `booking-lite` price from $200 to $250. Existing quotes still show $200.
**Design:** Correct behavior. Quotes are snapshots. New quotes will use the new price. Existing quotes are immutable (except draft quotes, which the operator can manually update).
**Risk level:** None. This is the intended design.

### Project duplication with quotes

**Scenario:** Operator duplicates a project that has quotes/contracts.
**Design decision:** Quotes and contracts are NOT copied during duplication. The duplicate starts fresh. The operator creates a new quote if needed.
**Rationale:** Quotes are tied to specific client negotiations. Copying them would create confusion about which quote is "real."
**Risk level:** None.

### Hard delete with active contract

**Scenario:** Operator tries to delete a project that has an active contract.
**Mitigation:** The delete confirmation should show "This project has an active contract. Deleting will permanently remove the contract." The operator must still type the slug to confirm. We don't block the delete — the operator is choosing to destroy the record.
**Risk level:** Low. The slug-confirmation UX prevents accidents.

---

## Appendix: Migration File List

```
Phase M1:
  20260330_add_selected_modules.sql

Phase P1:
  20260401_create_package_pricing.sql
  20260402_create_quotes.sql
  20260403_create_quote_lines.sql
  20260404_create_contracts.sql
  20260405_seed_package_pricing.sql
```

## Appendix: ClientRequest Schema Addition

Add to `packages/schemas/src/client-request.ts`:

```typescript
preferences?: {
  template?: string;
  modules?: string[];
  moduleConfig?: Record<string, Record<string, unknown>>;  // NEW
  domain?: string;
  notes?: string;
};
```

Update the JSON schema `properties.preferences.properties` to include:

```json
"moduleConfig": {
  "type": "object",
  "additionalProperties": {
    "type": "object"
  }
}
```

## Appendix: Type Definitions

```typescript
// Add to apps/portal/src/lib/types.ts

export interface SelectedModule {
  id: string;
  config?: Record<string, unknown>;
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
```
