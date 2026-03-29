create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  company_name text not null,
  website_url text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  status text not null default 'new'
    check (status in (
      'new',
      'researching',
      'analyzed',
      'ready_for_outreach',
      'converted',
      'disqualified'
    )),
  source text,
  campaign text,
  outreach_summary text,
  metadata jsonb not null default '{}',
  converted_client_id uuid references public.clients(id) on delete set null,
  converted_project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prospects_user_created
  on public.prospects(user_id, created_at desc);

create trigger prospects_updated_at
  before update on public.prospects
  for each row execute function public.handle_updated_at();

alter table public.prospects enable row level security;

create policy "Users can view own prospects"
  on public.prospects for select
  using (auth.uid()::text = user_id);

create policy "Users can create own prospects"
  on public.prospects for insert
  with check (auth.uid()::text = user_id);

create policy "Users can update own prospects"
  on public.prospects for update
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

create table if not exists public.prospect_site_analyses (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  status text not null default 'completed'
    check (status in ('pending', 'completed', 'failed')),
  analysis_source text not null default 'server_fetch'
    check (analysis_source in ('server_fetch', 'worker_job', 'manual')),
  site_title text,
  meta_description text,
  primary_h1 text,
  content_excerpt text,
  structured_output jsonb not null default '{}',
  raw_html_excerpt text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_prospect_site_analyses_prospect_created
  on public.prospect_site_analyses(prospect_id, created_at desc);

alter table public.prospect_site_analyses enable row level security;

create policy "Users can view analyses via prospect ownership"
  on public.prospect_site_analyses for select
  using (
    exists (
      select 1 from public.prospects p
      where p.id = prospect_site_analyses.prospect_id
        and p.user_id = auth.uid()::text
    )
  );

create policy "Users can create analyses via prospect ownership"
  on public.prospect_site_analyses for insert
  with check (
    exists (
      select 1 from public.prospects p
      where p.id = prospect_site_analyses.prospect_id
        and p.user_id = auth.uid()::text
    )
  );

alter table public.clients
  add column if not exists source_prospect_id uuid references public.prospects(id) on delete set null;

alter table public.projects
  add column if not exists source_prospect_id uuid references public.prospects(id) on delete set null;
