create table if not exists public.email_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('resend')),
  provider_event_id text not null,
  outreach_send_id uuid references public.outreach_sends(id) on delete set null,
  event_type text not null,
  provider_message_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists idx_email_provider_events_message_id
  on public.email_provider_events(provider_message_id);

create index if not exists idx_email_provider_events_send_id
  on public.email_provider_events(outreach_send_id);

alter table public.email_provider_events enable row level security;

create policy "Users can view provider events via outreach send ownership"
  on public.email_provider_events for select
  using (
    exists (
      select 1
      from public.outreach_sends os
      join public.prospects p on p.id = os.prospect_id
      where os.id = email_provider_events.outreach_send_id
        and p.user_id = auth.uid()::text
    )
  );
