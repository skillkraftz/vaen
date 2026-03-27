-- Add revision pointer columns to projects.
-- These track which revision is active and which was used for each pipeline step.

alter table public.projects
  add column current_revision_id uuid
    references public.project_request_revisions(id),
  add column last_exported_revision_id uuid
    references public.project_request_revisions(id),
  add column last_generated_revision_id uuid
    references public.project_request_revisions(id),
  add column last_reviewed_revision_id uuid
    references public.project_request_revisions(id);

comment on column public.projects.current_revision_id
  is 'The active/current request revision — used for editing and next operations';
comment on column public.projects.last_exported_revision_id
  is 'Revision that was last written to disk as client-request.json + prompt.txt';
comment on column public.projects.last_generated_revision_id
  is 'Revision that was used for the most recent site generation';
comment on column public.projects.last_reviewed_revision_id
  is 'Revision that was used for the most recent build + screenshot review';
