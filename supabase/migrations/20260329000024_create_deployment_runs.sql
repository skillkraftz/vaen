create table public.deployment_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  revision_id uuid references public.project_request_revisions(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'validated', 'failed')),
  trigger_source text not null default 'portal_manual'
    check (trigger_source in ('portal_manual', 'automation', 'retry')),
  provider text,
  provider_reference text,
  payload_metadata jsonb not null default '{}'::jsonb,
  log_summary text,
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deployment_runs_project_id_idx
  on public.deployment_runs (project_id, created_at desc);

create index deployment_runs_job_id_idx
  on public.deployment_runs (job_id);

alter table public.deployment_runs enable row level security;

create policy "Users can view deployment runs for own projects"
  on public.deployment_runs for select
  using (
    exists (
      select 1
      from public.projects
      where projects.id = deployment_runs.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "Users can create deployment runs for own projects"
  on public.deployment_runs for insert
  with check (
    exists (
      select 1
      from public.projects
      where projects.id = deployment_runs.project_id
        and projects.user_id = auth.uid()
    )
  );
