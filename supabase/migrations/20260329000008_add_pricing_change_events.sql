alter table public.package_pricing enable row level security;

create policy "Authenticated users can read pricing"
  on public.package_pricing for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can update pricing"
  on public.package_pricing for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create table if not exists public.pricing_change_events (
  id uuid primary key default gen_random_uuid(),
  pricing_item_id text not null references public.package_pricing(id) on delete cascade,
  changed_by text not null,
  changed_by_email text,
  previous_values jsonb not null default '{}',
  next_values jsonb not null default '{}',
  change_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pricing_change_events_item_created
  on public.pricing_change_events(pricing_item_id, created_at desc);

alter table public.pricing_change_events enable row level security;

create policy "Authenticated users can read pricing change events"
  on public.pricing_change_events for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can insert pricing change events"
  on public.pricing_change_events for insert
  with check (auth.role() = 'authenticated');
