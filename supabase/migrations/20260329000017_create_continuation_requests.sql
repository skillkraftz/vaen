-- Continuation requests bridge async job completion to the next operator action.
-- When automation dispatches a generate job with review intent, it creates a
-- pending continuation request rather than assuming synchronous progress.

create table if not exists public.continuation_requests (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null check (request_type in ('pending_review')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled', 'blocked')),
  context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.continuation_requests enable row level security;

create policy continuation_requests_access
  on public.continuation_requests
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists idx_continuation_requests_prospect
  on public.continuation_requests (prospect_id);

create index if not exists idx_continuation_requests_project
  on public.continuation_requests (project_id);

create index if not exists idx_continuation_requests_status
  on public.continuation_requests (status)
  where status = 'pending';
