-- Project events: audit trail for state transitions and actions
create table public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  event_type text not null,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index project_events_project_id_idx on public.project_events (project_id);

-- Row Level Security
alter table public.project_events enable row level security;

create policy "Users can view events for own projects"
  on public.project_events for select
  using (
    exists (
      select 1 from public.projects
      where projects.id = project_events.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "Users can create events for own projects"
  on public.project_events for insert
  with check (
    exists (
      select 1 from public.projects
      where projects.id = project_events.project_id
        and projects.user_id = auth.uid()
    )
  );
