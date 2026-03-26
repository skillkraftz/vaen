-- Assets: file references linked to projects
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  file_name text not null,
  file_type text not null,
  file_size bigint,
  storage_path text not null,
  category text not null default 'general',
  created_at timestamptz not null default now()
);

create index assets_project_id_idx on public.assets (project_id);

-- Row Level Security
alter table public.assets enable row level security;

create policy "Users can view assets for own projects"
  on public.assets for select
  using (
    exists (
      select 1 from public.projects
      where projects.id = assets.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "Users can create assets for own projects"
  on public.assets for insert
  with check (
    exists (
      select 1 from public.projects
      where projects.id = assets.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "Users can delete assets for own projects"
  on public.assets for delete
  using (
    exists (
      select 1 from public.projects
      where projects.id = assets.project_id
        and projects.user_id = auth.uid()
    )
  );
