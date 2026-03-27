-- Request revisions: immutable records of each client-request.json state.
-- Each edit (intake processing, user edit, AI import) creates a new revision
-- rather than overwriting the previous value.

create table public.project_request_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  source text not null check (source in (
    'intake_processor', 'user_edit', 'ai_import', 'manual'
  )),
  request_data jsonb not null,
  parent_revision_id uuid references public.project_request_revisions(id),
  summary text,
  created_at timestamptz not null default now()
);

create index idx_revisions_project
  on public.project_request_revisions (project_id, created_at desc);

-- RLS
alter table public.project_request_revisions enable row level security;

create policy "Users can view revisions for own projects"
  on public.project_request_revisions for select
  using (
    project_id in (
      select id from public.projects where user_id = auth.uid()
    )
  );

create policy "Users can create revisions for own projects"
  on public.project_request_revisions for insert
  with check (
    project_id in (
      select id from public.projects where user_id = auth.uid()
    )
  );
