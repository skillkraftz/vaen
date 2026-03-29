create table if not exists public.outreach_sends (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  outreach_package_id uuid references public.prospect_outreach_packages(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  recipient_email text not null,
  subject text not null,
  body text not null,
  attachment_links jsonb not null default '[]',
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'blocked')),
  provider text not null default 'resend',
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_outreach_sends_prospect_created
  on public.outreach_sends(prospect_id, created_at desc);

alter table public.outreach_sends enable row level security;

create policy "Users can view outreach sends via prospect ownership"
  on public.outreach_sends for select
  using (
    exists (
      select 1 from public.prospects p
      where p.id = outreach_sends.prospect_id
        and p.user_id = auth.uid()::text
    )
  );

create policy "Users can manage outreach sends via prospect ownership"
  on public.outreach_sends for all
  using (
    exists (
      select 1 from public.prospects p
      where p.id = outreach_sends.prospect_id
        and p.user_id = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1 from public.prospects p
      where p.id = outreach_sends.prospect_id
        and p.user_id = auth.uid()::text
    )
  );

alter table public.prospects
  add column if not exists outreach_status text not null default 'draft'
    check (outreach_status in ('draft', 'ready', 'sent', 'followup_due', 'replied', 'do_not_contact')),
  add column if not exists last_outreach_sent_at timestamptz,
  add column if not exists next_follow_up_due_at timestamptz,
  add column if not exists follow_up_count integer not null default 0;
