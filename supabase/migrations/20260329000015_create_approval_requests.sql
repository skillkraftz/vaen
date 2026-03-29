create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null
    check (request_type in ('large_discount', 'batch_outreach', 'project_purge')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  resolved_by uuid references auth.users(id) on delete set null,
  context jsonb not null default '{}'::jsonb,
  resolution_note text,
  expires_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_approval_requests_status
  on public.approval_requests(status)
  where status = 'pending';

create index if not exists idx_approval_requests_requested_by
  on public.approval_requests(requested_by);

alter table public.approval_requests enable row level security;

create or replace function public.is_sole_admin(target_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (
    select count(*)
    from public.user_roles
    where role = 'admin'
  ) = 1
  and exists (
    select 1
    from public.user_roles
    where user_id = coalesce(target_user_id, auth.uid())
      and role = 'admin'
  );
$$;

grant execute on function public.is_sole_admin(uuid) to authenticated;

drop policy if exists approval_read on public.approval_requests;
create policy approval_read on public.approval_requests for select
  using (auth.uid() = requested_by or public.is_admin());

drop policy if exists approval_insert on public.approval_requests;
create policy approval_insert on public.approval_requests for insert
  with check (auth.uid() = requested_by);

drop policy if exists approval_resolve on public.approval_requests;
create policy approval_resolve on public.approval_requests for update
  using (public.is_admin() and (auth.uid() != requested_by or public.is_sole_admin()))
  with check (public.is_admin() and (auth.uid() != requested_by or public.is_sole_admin()));
