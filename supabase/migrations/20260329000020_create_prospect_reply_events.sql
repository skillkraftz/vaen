create table if not exists public.prospect_reply_events (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  outreach_send_id uuid references public.outreach_sends(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  reply_note text,
  reply_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_prospect_reply_events_prospect_id
  on public.prospect_reply_events(prospect_id, created_at desc);

create index if not exists idx_prospect_reply_events_outreach_send_id
  on public.prospect_reply_events(outreach_send_id)
  where outreach_send_id is not null;

alter table public.prospect_reply_events enable row level security;

drop policy if exists prospect_reply_events_read_own on public.prospect_reply_events;
create policy prospect_reply_events_read_own on public.prospect_reply_events for select
  using (
    exists (
      select 1
      from public.prospects
      where prospects.id = prospect_reply_events.prospect_id
        and prospects.user_id = auth.uid()
    )
  );

drop policy if exists prospect_reply_events_insert_own on public.prospect_reply_events;
create policy prospect_reply_events_insert_own on public.prospect_reply_events for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.prospects
      where prospects.id = prospect_reply_events.prospect_id
        and prospects.user_id = auth.uid()
    )
  );
