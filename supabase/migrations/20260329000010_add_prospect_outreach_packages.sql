create table if not exists public.prospect_outreach_packages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'ready')),
  package_data jsonb not null default '{}',
  offer_summary text,
  email_subject text,
  email_body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prospect_outreach_packages_prospect_created
  on public.prospect_outreach_packages(prospect_id, created_at desc);

create trigger prospect_outreach_packages_updated_at
  before update on public.prospect_outreach_packages
  for each row execute function public.handle_updated_at();

alter table public.prospect_outreach_packages enable row level security;

create policy "Users can view outreach packages via prospect ownership"
  on public.prospect_outreach_packages for select
  using (
    exists (
      select 1 from public.prospects p
      where p.id = prospect_outreach_packages.prospect_id
        and p.user_id = auth.uid()::text
    )
  );

create policy "Users can manage outreach packages via prospect ownership"
  on public.prospect_outreach_packages for all
  using (
    exists (
      select 1 from public.prospects p
      where p.id = prospect_outreach_packages.prospect_id
        and p.user_id = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1 from public.prospects p
      where p.id = prospect_outreach_packages.prospect_id
        and p.user_id = auth.uid()::text
    )
  );
