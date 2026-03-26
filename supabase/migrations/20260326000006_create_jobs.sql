-- Jobs table: tracks worker-executed pipeline jobs for each project.
-- Portal creates job records; worker picks them up and executes them.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  job_type text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  payload jsonb not null default '{}',
  result jsonb,
  stdout text,
  stderr text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- Index for worker polling (pending jobs) and portal queries (project jobs)
create index idx_jobs_status on public.jobs (status) where status = 'pending';
create index idx_jobs_project_id on public.jobs (project_id, created_at desc);

-- RLS: users can read jobs for their own projects
alter table public.jobs enable row level security;

create policy "Users can view their project jobs"
  on public.jobs for select
  using (
    project_id in (
      select id from public.projects where user_id = auth.uid()
    )
  );

-- Note: The worker uses the service_role key which bypasses RLS,
-- allowing it to read pending jobs and update status/results.
