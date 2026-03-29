create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_campaigns_user_created
  on public.campaigns(user_id, created_at desc);

alter table public.campaigns enable row level security;

create policy "Users can view own campaigns"
  on public.campaigns for select
  using (user_id = auth.uid()::text);

create policy "Users can create own campaigns"
  on public.campaigns for insert
  with check (user_id = auth.uid()::text);

create policy "Users can update own campaigns"
  on public.campaigns for update
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "Users can delete own campaigns"
  on public.campaigns for delete
  using (user_id = auth.uid()::text);

alter table public.prospects
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;

create index if not exists idx_prospects_campaign_created
  on public.prospects(campaign_id, created_at desc);

alter table public.outreach_sends
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;

create index if not exists idx_outreach_sends_campaign_created
  on public.outreach_sends(campaign_id, created_at desc);
