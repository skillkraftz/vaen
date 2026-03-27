-- Migrate existing draft_request/final_request data into revisions.
-- This is idempotent: running it when revisions already exist will create
-- duplicates (harmless but noisy). Only run once.
--
-- draft_request and final_request columns are NOT dropped — they remain
-- as a rollback safety net until all code paths use revisions.

-- Step 1: Create revisions from draft_request
insert into public.project_request_revisions (id, project_id, source, request_data, summary, created_at)
select
  gen_random_uuid(),
  id,
  'intake_processor',
  draft_request,
  'Migrated from draft_request column',
  coalesce(updated_at, now())
from public.projects
where draft_request is not null;

-- Step 2: Create revisions from final_request (AI imports)
insert into public.project_request_revisions (id, project_id, source, request_data, summary, created_at)
select
  gen_random_uuid(),
  id,
  'ai_import',
  final_request,
  'Migrated from final_request column',
  coalesce(updated_at + interval '1 second', now())
from public.projects
where final_request is not null;

-- Step 3: Set current_revision_id to the most recent revision for each project
update public.projects p
set current_revision_id = (
  select r.id
  from public.project_request_revisions r
  where r.project_id = p.id
  order by r.created_at desc
  limit 1
)
where exists (
  select 1 from public.project_request_revisions r where r.project_id = p.id
);

-- Step 4: For projects past intake_approved, set last_exported_revision_id
update public.projects p
set last_exported_revision_id = current_revision_id
where current_revision_id is not null
  and status not in (
    'intake_received', 'intake_processing', 'intake_draft_ready',
    'intake_needs_revision', 'intake_approved', 'custom_quote_required'
  );

-- Step 5: For projects that were generated, set last_generated_revision_id
update public.projects p
set last_generated_revision_id = current_revision_id
where current_revision_id is not null
  and status in (
    'workspace_generated', 'build_in_progress', 'build_failed',
    'review_ready', 'deploy_ready', 'deploying', 'deployed', 'managed'
  );

-- Step 6: For projects that were reviewed, set last_reviewed_revision_id
update public.projects p
set last_reviewed_revision_id = current_revision_id
where current_revision_id is not null
  and status in (
    'review_ready', 'deploy_ready', 'deploying', 'deployed', 'managed'
  );
