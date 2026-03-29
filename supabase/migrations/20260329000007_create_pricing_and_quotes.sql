create table if not exists public.package_pricing (
  id text primary key,
  item_type text not null check (item_type in ('template', 'module')),
  label text not null,
  description text,
  setup_price_cents integer not null default 0,
  recurring_price_cents integer not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger package_pricing_updated_at
  before update on public.package_pricing
  for each row execute function public.handle_updated_at();

insert into public.package_pricing (
  id, item_type, label, description, setup_price_cents, recurring_price_cents, sort_order
) values
  ('service-core', 'template', 'Service Core Website', 'Standard local service business website', 150000, 9900, 1),
  ('service-area', 'template', 'Service Area Website', 'Multi-location / wide service area website', 200000, 12900, 2),
  ('authority', 'template', 'Authority Website', 'Professional services authority website', 250000, 14900, 3),
  ('maps-embed', 'module', 'Maps Embed', 'Google Maps showing business location', 0, 0, 10),
  ('manual-testimonials', 'module', 'Testimonials', 'Static testimonials section', 0, 0, 11),
  ('booking-lite', 'module', 'Online Booking', 'Calendly / Cal.com embed', 20000, 2500, 12),
  ('google-reviews-live', 'module', 'Live Google Reviews', 'Google Reviews feed via Places API', 15000, 1500, 13)
on conflict (id) do update set
  item_type = excluded.item_type,
  label = excluded.label,
  description = excluded.description,
  setup_price_cents = excluded.setup_price_cents,
  recurring_price_cents = excluded.recurring_price_cents,
  active = true,
  sort_order = excluded.sort_order;

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  quote_number integer generated always as identity,
  revision_id uuid references public.project_request_revisions(id) on delete set null,
  template_id text not null,
  selected_modules_snapshot jsonb not null default '[]',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  setup_subtotal_cents integer not null default 0,
  recurring_subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  discount_percent numeric(5,2),
  discount_reason text,
  discount_approved_by text,
  setup_total_cents integer not null default 0,
  recurring_total_cents integer not null default 0,
  valid_days integer not null default 30,
  valid_until timestamptz,
  client_name text,
  client_email text,
  notes text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quotes_project on public.quotes(project_id);

create trigger quotes_updated_at
  before update on public.quotes
  for each row execute function public.handle_updated_at();

alter table public.quotes enable row level security;

create policy "Users manage quotes via project ownership"
  on public.quotes for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = quotes.project_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = quotes.project_id and p.user_id = auth.uid()
    )
  );

create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  line_type text not null
    check (line_type in ('template', 'module', 'addon', 'discount')),
  reference_id text,
  label text not null,
  description text,
  setup_price_cents integer not null default 0,
  recurring_price_cents integer not null default 0,
  quantity integer not null default 1,
  sort_order integer not null default 0
);

create index if not exists idx_quote_lines_quote on public.quote_lines(quote_id);

alter table public.quote_lines enable row level security;

create policy "Users manage quote_lines via project ownership"
  on public.quote_lines for all
  using (
    exists (
      select 1 from public.quotes q
      join public.projects p on p.id = q.project_id
      where q.id = quote_lines.quote_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.quotes q
      join public.projects p on p.id = q.project_id
      where q.id = quote_lines.quote_id and p.user_id = auth.uid()
    )
  );

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.quotes(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  contract_number integer generated always as identity,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  billing_type text not null default 'one_time'
    check (billing_type in ('one_time', 'monthly', 'annual')),
  setup_amount_cents integer not null,
  recurring_amount_cents integer not null default 0,
  started_at timestamptz not null default now(),
  renewal_at timestamptz,
  notes text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_contracts_project on public.contracts(project_id);
create index if not exists idx_contracts_client on public.contracts(client_id);

alter table public.contracts enable row level security;

create policy "Users manage contracts via project ownership"
  on public.contracts for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = contracts.project_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = contracts.project_id and p.user_id = auth.uid()
    )
  );
