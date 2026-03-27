-- Add request_revision_id to assets so screenshots are bound to a specific revision.
-- This lets us show which screenshots belong to which version of the request.

alter table public.assets
  add column if not exists request_revision_id uuid
    references public.project_request_revisions(id) on delete set null;

-- Index for querying screenshots by revision
create index if not exists idx_assets_revision
  on public.assets(request_revision_id)
  where request_revision_id is not null;
