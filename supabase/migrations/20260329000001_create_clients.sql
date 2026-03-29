-- Clients: first-class entity above projects.
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  business_type text,
  notes text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_user_id_idx on public.clients (user_id);
create index clients_name_idx on public.clients (name);

create trigger clients_updated_at
  before update on public.clients
  for each row execute function public.handle_updated_at();

alter table public.clients enable row level security;

create policy "Users can view own clients"
  on public.clients for select
  using (auth.uid() = user_id);

create policy "Users can create clients"
  on public.clients for insert
  with check (auth.uid() = user_id);

create policy "Users can update own clients"
  on public.clients for update
  using (auth.uid() = user_id);
