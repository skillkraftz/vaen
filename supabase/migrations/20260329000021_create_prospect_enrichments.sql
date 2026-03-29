create table if not exists public.prospect_enrichments (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  source text not null default 'heuristic_v1'
    check (source in ('heuristic_v1', 'worker_job', 'manual')),
  business_summary text,
  recommended_package text,
  opportunity_summary text,
  missing_pieces jsonb not null default '[]'::jsonb,
  offer_positioning text,
  precreated_copy jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prospect_enrichments_prospect_created
  on public.prospect_enrichments(prospect_id, created_at desc);

create trigger prospect_enrichments_updated_at
  before update on public.prospect_enrichments
  for each row execute function public.handle_updated_at();

alter table public.prospect_enrichments enable row level security;

drop policy if exists prospect_enrichments_read_own on public.prospect_enrichments;
create policy prospect_enrichments_read_own on public.prospect_enrichments for select
  using (
    exists (
      select 1
      from public.prospects
      where prospects.id = prospect_enrichments.prospect_id
        and prospects.user_id = auth.uid()::text
    )
  );

drop policy if exists prospect_enrichments_insert_own on public.prospect_enrichments;
create policy prospect_enrichments_insert_own on public.prospect_enrichments for insert
  with check (
    exists (
      select 1
      from public.prospects
      where prospects.id = prospect_enrichments.prospect_id
        and prospects.user_id = auth.uid()::text
    )
  );

drop policy if exists prospect_enrichments_update_own on public.prospect_enrichments;
create policy prospect_enrichments_update_own on public.prospect_enrichments for update
  using (
    exists (
      select 1
      from public.prospects
      where prospects.id = prospect_enrichments.prospect_id
        and prospects.user_id = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1
      from public.prospects
      where prospects.id = prospect_enrichments.prospect_id
        and prospects.user_id = auth.uid()::text
    )
  );
