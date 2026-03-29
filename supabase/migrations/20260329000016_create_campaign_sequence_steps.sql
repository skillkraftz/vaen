create table if not exists public.campaign_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  step_number integer not null check (step_number between 1 and 5),
  label text not null,
  delay_days integer not null default 0 check (delay_days >= 0),
  subject_template text,
  body_template text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, step_number)
);

create index if not exists idx_campaign_steps_campaign
  on public.campaign_sequence_steps(campaign_id);

alter table public.campaign_sequence_steps enable row level security;

drop policy if exists steps_access on public.campaign_sequence_steps;
create policy steps_access on public.campaign_sequence_steps for all
  using (
    exists (
      select 1
      from public.campaigns
      where public.campaigns.id = public.campaign_sequence_steps.campaign_id
        and public.campaigns.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.campaigns
      where public.campaigns.id = public.campaign_sequence_steps.campaign_id
        and public.campaigns.user_id = auth.uid()
    )
  );
