create table public.worker_heartbeats (
  worker_id text primary key,
  hostname text not null,
  current_job_id uuid references public.jobs(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  status text not null default 'idle'
    check (status in ('idle', 'running', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index worker_heartbeats_last_seen_idx
  on public.worker_heartbeats (last_seen_at desc);

alter table public.worker_heartbeats enable row level security;

create policy "Authenticated users can view worker heartbeats"
  on public.worker_heartbeats for select
  to authenticated
  using (true);

create or replace function public.claim_next_job(p_worker_id text default null)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.jobs
  set
    status = 'running',
    started_at = coalesce(started_at, now()),
    result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
      'worker_id', p_worker_id,
      'claimed_at', now()
    )
  where id = (
    select jobs.id
    from public.jobs
    where jobs.status = 'pending'
    order by jobs.created_at asc
    for update skip locked
    limit 1
  )
  returning *;
end;
$$;

revoke all on function public.claim_next_job(text) from public;
revoke all on function public.claim_next_job(text) from anon;
revoke all on function public.claim_next_job(text) from authenticated;
grant execute on function public.claim_next_job(text) to service_role;
