# vaen Operations System Spec

**Status:** Design spec, ready for phased implementation
**Date:** 2026-03-29

This spec covers five feature areas that together evolve vaen from a working pipeline into an agency operations system: clients, project variants, archive/delete, module management, and pricing/quoting.

---

## A. Product Model

### Entity Relationships

```
Client (1) ──< (N) Project (1) ──< (N) Revision
                    │                     │
                    │ variant_of?         │ request_data (has modules/template)
                    │                     │
                    ├──< (N) Job          ├──< (N) RevisionAsset
                    ├──< (N) Asset
                    ├──< (N) ProjectEvent
                    │
                    └──< (N) Quote ──< (N) QuoteLine
                                │
                                └──< (0..1) Contract
```

### How It Works

**Client** is the business entity. They have a name, contact info, business type, and notes. A client can have multiple projects (initial site, redesign, variant comparison, seasonal campaign).

**Project** is a single website build attempt. It belongs to one client. It has a `variant_of` pointer for duplicates/comparisons. Each project still has its own slug, status, revisions, jobs, and artifacts.

**Module selection** lives on the revision, inside `request_data.preferences.modules[]`. This means module changes create new revisions, which naturally triggers the existing staleness system. No new staleness machinery needed.

**Quote** is a pricing snapshot attached to a project at a point in time. It references a specific template + module set, has line items with pricing, and can include discounts. A quote can be "accepted" to become a contract.

**Contract** is an accepted quote with billing terms. One contract per quote. Contracts reference the quote they came from.

### Operator Workflows

**New client + new project:**
1. Dashboard -> "+ New Project"
2. Step 1: Select existing client OR enter new client info
3. If new: fill client fields (name, business type, contact, notes)
4. Step 2: Project details (name, slug auto-generated from client name, notes/transcript)
5. Step 3: Upload files
6. Submit -> creates client (if new) + project + assets + event
7. Redirect to project detail

**Existing client + new project:**
1. Dashboard -> "+ New Project"
2. Step 1: Search/select existing client
3. Client fields are prefilled and read-only (can be overridden per-project via notes)
4. Step 2: Project name (defaults to client name), slug, additional notes
5. Step 3: Upload files
6. Submit -> creates project linked to client + assets + event

**Duplicate/variant creation:**
1. Project detail -> "Duplicate" (in Advanced Tools)
2. Modal: new project name, new slug (auto-suggested: `{slug}-v2`)
3. Options: "Copy current revision data" (checked by default)
4. Creates new project with `variant_of = original.id`
5. Copies: latest revision's request_data, client_summary, recommendations
6. Does NOT copy: generated workspace, screenshots, jobs, review state
7. New project starts at `intake_draft_ready` (skip re-processing since we have a revision)
8. Original project unchanged

**Archive/delete:**
- Archive: soft flag on project. Hidden from dashboard by default. Recoverable.
- Delete: hard delete. Removes project + all DB rows + storage assets + generated filesystem artifacts. Requires double confirmation ("type the slug to confirm").
- Purge (filesystem only): removes `generated/{slug}/` without deleting DB records. Useful for disk cleanup.

**Module changes:**
1. Project detail -> Website Plan -> Recommendations section
2. Operator can add/remove modules via checkbox UI
3. Saving creates a new revision with updated `preferences.modules`
4. Existing staleness system kicks in: export/generate/review become "outdated"
5. Next Step banner updates: "Content has changed - rebuild needed"

**Pricing / quotes:**
1. Project detail -> new "Quote" section (below Website Plan)
2. Auto-generates line items from template + modules
3. Operator can adjust prices, add discounts, add custom lines
4. "Create Quote" -> saves snapshot
5. "Accept Quote" -> creates contract record
6. Quote PDF / contract PDF generation (future)

---

## B. Data Model

### New Tables

#### `clients`

```sql
create table clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  business_type text,
  contact_name text,
  contact_email text,
  contact_phone text,
  address_street text,
  address_city text,
  address_state text,
  address_zip text,
  notes text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table clients enable row level security;
create policy "Users can manage own clients"
  on clients for all using (auth.uid() = user_id);

create index idx_clients_user on clients(user_id);
create index idx_clients_name on clients(user_id, name);
```

#### Changes to `projects`

```sql
-- Add client linkage, variant tracking, archive flag
alter table projects
  add column client_id uuid references clients(id) on delete set null,
  add column variant_of uuid references projects(id) on delete set null,
  add column archived_at timestamptz;

create index idx_projects_client on projects(client_id);
create index idx_projects_variant on projects(variant_of);
```

#### `quotes`

```sql
create table quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  revision_id uuid references project_request_revisions(id),
  template_id text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  discount_reason text,
  total_cents integer not null default 0,
  valid_until timestamptz,
  notes text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table quotes enable row level security;
create policy "Users manage quotes via project ownership"
  on quotes for all using (
    exists (
      select 1 from projects p where p.id = quotes.project_id and p.user_id = auth.uid()
    )
  );
```

#### `quote_lines`

```sql
create table quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  line_type text not null check (line_type in ('base', 'module', 'addon', 'discount', 'recurring')),
  label text not null,
  description text,
  reference_id text,       -- e.g. module id, template id
  unit_price_cents integer not null default 0,
  quantity integer not null default 1,
  total_cents integer not null default 0,
  sort_order integer not null default 0
);

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

#### `contracts`

```sql
create table contracts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references quotes(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  billing_type text not null default 'one_time'
    check (billing_type in ('one_time', 'monthly', 'annual')),
  amount_cents integer not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  notes text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table contracts enable row level security;
create policy "Users manage contracts via project ownership"
  on contracts for all using (
    exists (
      select 1 from projects p where p.id = contracts.project_id and p.user_id = auth.uid()
    )
  );
```

#### `package_pricing` (seed/config table)

```sql
create table package_pricing (
  id text primary key,           -- e.g. 'service-core', 'maps-embed'
  item_type text not null check (item_type in ('template', 'module')),
  label text not null,
  base_price_cents integer not null default 0,
  recurring_price_cents integer not null default 0,   -- monthly
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- No RLS needed (read-only reference data, admin-managed)
```

### What Lives Where

| Data | Location | Rationale |
|------|----------|-----------|
| Business name, type, contact | `clients` table | Shared across projects, canonical source |
| Project-specific overrides | `projects.notes`, revision `request_data` | Each project can diverge |
| Template + module selection | `revision.request_data.preferences` | Versioned with the revision |
| Module definitions | `packages/module-registry` + `package_pricing` | Code defines capabilities; DB defines pricing |
| Quote snapshot | `quotes` + `quote_lines` | Immutable pricing record at a point in time |
| Archive flag | `projects.archived_at` | Nullable timestamp = soft delete |
| Variant lineage | `projects.variant_of` | Simple FK, no deep tree required |

### Client vs Project Data

**On create:** Client data is **copied** into the project's first revision `request_data`. The project proceeds with its own copy.

**On later client edits:** Existing projects are NOT updated. This is intentional. The revision is the source of truth for what gets built. If the operator wants to sync, they re-process the intake or manually edit.

**Rationale:** Projects represent a build at a point in time. If a client changes their phone number after a site is deployed, that shouldn't silently alter an in-progress build. The operator decides when to sync.

---

## C. UI / UX Proposal

### Dashboard Changes

**Filter bar** (above project list):
- `All | Active | Archived` toggle (default: Active)
- Search by name/slug (future, not phase 1)

**"+ New Project" button** unchanged, but the target page changes.

**Project cards:** Add client name as subtitle if present. Add archive indicator if archived.

### New Project Flow (replaces `/dashboard/new`)

**Step 1 — Client**

Two-panel choice at the top:
- **"New Client"** (default selected) — shows inline form fields: name, business type, contact name, email, phone, address
- **"Existing Client"** — shows a searchable dropdown of existing clients. Selecting one fills the form fields as read-only with an "Edit for this project" toggle

Not a modal. Not a stepper. A single page with a client section at the top and project section below it. The client section has the two-panel toggle. This is simpler and faster than a multi-step wizard.

**Step 2 — Project** (below client section, same page)

- Project name (defaults to client name if client was selected/created)
- Slug (auto-generated, editable)
- Notes / transcript
- File uploads

**Submit** creates client (if new) + project + assets in one server action.

### Project Detail Changes

**Header:** Already shows business type + contact from pass 2B. Now also shows client name as a link (if client exists).

**New section: "Quote"** — between Website Plan and Business Details:
- Shows current quote status or "No quote yet"
- "Create Quote" button auto-populates from template + modules
- Line items table (editable: price, quantity, description)
- Discount row with reason field
- Total
- "Accept" / "Reject" actions

**Duplicate button:** Inside Advanced Tools section. Opens a small inline form (new name, new slug, checkbox for "copy revision data"). Not a modal.

**Archive/Delete:** Inside Advanced Tools section.
- "Archive Project" — single click with undo toast
- "Delete Project" — requires typing slug to confirm. Shows what will be deleted (N jobs, N assets, N revisions, generated files).

**Module management:** In the Website Plan > Recommendations section. Currently shows template + modules as read-only. Change to:
- Template: still read-only (changing template is a rebuild-from-scratch decision)
- Modules: checkbox list of available modules for this template. Toggling a module and saving creates a new revision.

### Banners and Warnings

**Module change banner:** When modules differ between current_revision and last_generated_revision:
> "Module selection has changed since the last build. Rebuild to apply changes."

This is handled by the existing staleness system — module changes create new revisions, which naturally make `last_generated_revision_id !== current_revision_id`.

**Archive banner:** On archived project detail page:
> "This project is archived. [Restore]"

**Variant badge:** On project header if `variant_of` is set:
> "Variant of [Original Name]"

**Quote status badge:** In the Quote section header, similar to project status badges.

---

## D. State / Staleness Rules

### Client -> Project Data Copy

| Event | Behavior |
|-------|----------|
| New project from existing client | Copy client fields into project + first revision `request_data` |
| Client info edited later | No effect on existing projects |
| Operator wants to sync | Re-process intake, or manual edit, creates new revision |

### Duplication

| What | Copied | Reset |
|------|--------|-------|
| `request_data` from current revision | Yes | |
| `client_summary` | Yes | |
| `recommendations` | Yes | |
| `client_id` | Yes (same client) | |
| `status` | | Set to `intake_draft_ready` |
| Revision pointers (exported/generated/reviewed) | | All null |
| Jobs | | Not copied |
| Assets (uploaded files) | Yes (referenced, not duplicated in storage) | |
| Generated workspace / screenshots | | Not copied |
| Quotes / contracts | | Not copied |

### Module Changes

Module selection is stored in `revision.request_data.preferences.modules[]`.

| Event | What happens |
|-------|-------------|
| Operator toggles a module checkbox | New revision created with updated modules list |
| `current_revision_id` changes | Existing staleness detection fires |
| `last_exported_revision_id !== current_revision_id` | "Content Prepared: Outdated" |
| `last_generated_revision_id !== current_revision_id` | "Website Built: Outdated — rebuild needed" |
| `last_reviewed_revision_id !== current_revision_id` | "Preview: Outdated" |
| Next Step banner | Updates to prompt rebuild |

No new staleness machinery. The revision system already handles this.

### Archive

| Event | Behavior |
|-------|----------|
| Archive | Sets `archived_at = now()`. Project hidden from default dashboard view. |
| Restore | Sets `archived_at = null`. |
| Archive does NOT | Delete any data, stop running jobs, or affect generated files. |

### Hard Delete

| Step | What gets deleted |
|------|-------------------|
| 1 | All `quote_lines` via cascade |
| 2 | All `quotes` via cascade |
| 3 | All `contracts` via cascade |
| 4 | All `jobs` via cascade |
| 5 | All `revision_assets` via cascade |
| 6 | All `project_request_revisions` via cascade |
| 7 | All `assets` via cascade + storage bucket files |
| 8 | All `project_events` via cascade |
| 9 | The `project` row |
| 10 | `generated/{slug}/` directory on filesystem |
| 11 | Storage bucket folder `{user_id}/{project_id}/` |

The cascade handles steps 1-9 automatically (FK on delete cascade). Steps 10-11 need explicit cleanup in the server action.

---

## E. Implementation Phases

### Phase 1: Clients + New Project Flow (1-2 days)

**Scope:**
- `clients` table migration
- `projects.client_id` column
- `Client` type in types.ts
- Client CRUD server actions
- Redesigned `/dashboard/new` page with client selection
- Client name display on dashboard cards and project header
- Backfill: create client records from existing projects (migration script)

**Why first:** Highest business value. Every new project immediately benefits. Low risk — additive change, no existing workflows broken.

**Codex-suitable:** Yes, after you provide the migration SQL and type definitions. The UI is straightforward form work.

### Phase 2: Archive + Delete (0.5-1 day)

**Scope:**
- `projects.archived_at` column migration
- Dashboard filter (All / Active / Archived)
- Archive/restore actions + UI in Advanced Tools
- Hard delete action with slug confirmation
- Filesystem cleanup (`generated/{slug}/`)
- Storage cleanup (supabase bucket)

**Why second:** Immediate operational need. Dashboard will accumulate test/audit projects. Simple to implement.

**Codex-suitable:** Yes. Well-defined scope. Filesystem/storage cleanup needs careful implementation but is mechanical.

### Phase 3: Project Duplication (0.5-1 day)

**Scope:**
- `projects.variant_of` column migration
- Duplicate action in Advanced Tools
- Server action: creates new project, copies revision data, links variant
- Variant badge on project header
- Dashboard: show variant indicator on cards

**Why third:** Enables service-level comparison workflow. Depends on client linkage from Phase 1.

**Codex-suitable:** Yes. The server action is the only interesting part.

### Phase 4: Module Management UI (1-2 days)

**Scope:**
- Module checkbox UI in Website Plan > Recommendations
- Server action: save module changes as new revision
- Integration with existing staleness/rebuild system
- Show module list with descriptions from module-registry
- Template compatibility filtering

**Why fourth:** Requires the revision system to be well-understood. Touches the core pipeline contract (what modules are in `request_data`). Needs careful testing.

**Codex-suitable:** Partially. The UI is straightforward. The revision creation logic and ensuring the generator respects the module list needs design judgment. Worth reviewing the generator's module handling before handing off.

### Phase 5: Pricing + Quotes (2-3 days)

**Scope:**
- `package_pricing`, `quotes`, `quote_lines`, `contracts` migrations
- Seed data for template/module pricing
- Quote creation server action (auto-populates from template + modules)
- Quote editor UI (line items, discounts, totals)
- Quote status management (draft -> sent -> accepted/rejected)
- Contract creation from accepted quote
- Quote section on project detail page

**Why last:** Highest complexity, lowest urgency for the pipeline to function. Depends on module management being in place. Business logic (discounts, pricing tiers) will evolve.

**Codex-suitable:** The migrations and basic CRUD are. The pricing logic and discount guardrails need design decisions during implementation.

### Phase 6 (Future): Quote/Contract PDF, Renewal Pricing, Client Portal

Not in scope for this spec. Flagged for later:
- PDF generation for quotes and contracts
- Renewal/upgrade/downgrade pricing logic
- Client-facing portal (view quote, approve, sign)
- Billing integration

---

## F. Risks / Edge Cases

### Client/Project Drift

**Risk:** Operator edits client info expecting all projects to update.
**Mitigation:** Clear UI: "Client info is copied when a project is created. Changes to the client record do not affect existing projects." Show a diff indicator if client info has diverged from the project's stored data (future enhancement, not phase 1).

### Duplicate Slug Handling

**Risk:** Duplicating project `acme-plumbing` auto-suggests `acme-plumbing-v2`, but that might already exist.
**Mitigation:** Server action checks slug uniqueness before insert. If collision, append incrementing number (`-v3`, `-v4`). UI shows error if operator manually picks a taken slug.

### Archive vs Delete Safety

**Risk:** Operator hard-deletes a project they meant to archive.
**Mitigation:**
- Archive is the default/easy action (single click + undo toast)
- Delete requires typing the slug
- Delete confirmation shows what will be destroyed (count of jobs, assets, revisions)
- No "delete all" bulk action

### Discount Abuse / Approvals

**Risk:** Operator applies 100% discount.
**Mitigation (phase 5):**
- Discount field has a max percentage cap (configurable, default 25%)
- Discounts above cap require entering a reason
- Audit trail: all quote changes logged in project_events
- Future: approval workflow for large discounts (not in phase 5)

### Module Removal Breaking Output

**Risk:** Operator removes a module after the site was built with it. The generated site has components referencing that module.
**Mitigation:**
- Module removal creates a new revision (staleness kicks in)
- Next Step banner says "rebuild needed"
- Generator already handles module list from request_data — if a module isn't listed, it isn't overlaid
- The rebuild produces a clean site without the removed module

### Quote Drift

**Risk:** Operator creates a quote, then changes modules. Quote no longer matches the project.
**Mitigation:**
- Quote stores `revision_id` it was created from
- If current revision differs from quote's revision, show a badge: "Quote may be outdated — module selection has changed since this quote was created"
- Operator can create a new quote at any time
- Old quotes remain as historical records

### Generated Filesystem Cleanup on Delete

**Risk:** `generated/{slug}/` contains files from multiple runs. Hard delete must clean all of them.
**Mitigation:** Delete action uses `rm -rf generated/{slug}/` after confirming the slug matches. The slug is unique per project, so this is safe. Log the deletion in stdout for auditability.

### Variant Comparison

**Risk:** Operator wants to compare two variants side-by-side.
**Mitigation (not phase 3):** Phase 3 just tracks lineage. Side-by-side comparison view is a future UI enhancement. For now, operator opens both projects in separate tabs. The variant badge makes the relationship visible.

---

## Appendix: Migration Sequence

For safe incremental deployment, migrations should be applied in this order:

```
Phase 1:
  20260330000001_create_clients.sql
  20260330000002_add_client_to_projects.sql
  20260330000003_backfill_clients.sql           -- optional: creates clients from existing projects

Phase 2:
  20260331000001_add_project_archive.sql

Phase 3:
  20260331000002_add_project_variant.sql

Phase 5:
  20260401000001_create_package_pricing.sql
  20260401000002_create_quotes.sql
  20260401000003_create_contracts.sql
  20260401000004_seed_package_pricing.sql
```

All migrations are additive. No existing columns are removed or renamed. No existing constraints are modified. Existing projects continue to work with `client_id = null`.
