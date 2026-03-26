-- Add intake processing columns to projects table
-- Stores generated drafts, missing-info analysis, and recommendations

alter table public.projects
  add column client_summary text,
  add column draft_request jsonb,
  add column missing_info jsonb,
  add column recommendations jsonb;

comment on column public.projects.client_summary is 'Generated markdown summary of the client intake';
comment on column public.projects.draft_request is 'Draft client-request.json mapped from portal intake data';
comment on column public.projects.missing_info is 'Array of missing/incomplete fields detected during processing';
comment on column public.projects.recommendations is 'Template and module recommendations with reasoning';
