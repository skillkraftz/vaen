create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'operator'
    check (role in ('viewer', 'sales', 'operator', 'admin')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

create or replace function public.is_admin(target_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = coalesce(target_user_id, auth.uid())
      and role = 'admin'
  );
$$;

create or replace function public.get_effective_role(target_user_id uuid default auth.uid())
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select role from public.user_roles where user_id = coalesce(target_user_id, auth.uid())),
    'operator'
  );
$$;

create or replace function public.bootstrap_user_role(target_user_id uuid)
returns table (
  user_id uuid,
  role text,
  granted_by uuid,
  granted_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role text;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('public.user_roles.bootstrap', 0));

  if exists (select 1 from public.user_roles where public.user_roles.user_id = target_user_id) then
    return query
    select ur.user_id, ur.role, ur.granted_by, ur.granted_at, ur.created_at
    from public.user_roles ur
    where ur.user_id = target_user_id;
    return;
  end if;

  assigned_role := case
    when exists (select 1 from public.user_roles) then 'operator'
    else 'admin'
  end;

  insert into public.user_roles (user_id, role, granted_by)
  values (
    target_user_id,
    assigned_role,
    case when assigned_role = 'admin' then target_user_id else null end
  );

  return query
  select ur.user_id, ur.role, ur.granted_by, ur.granted_at, ur.created_at
  from public.user_roles ur
  where ur.user_id = target_user_id;
end;
$$;

grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.get_effective_role(uuid) to authenticated;
grant execute on function public.bootstrap_user_role(uuid) to authenticated;

drop policy if exists user_roles_read on public.user_roles;
create policy user_roles_read on public.user_roles for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles for insert
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists user_roles_update_admin on public.user_roles;
create policy user_roles_update_admin on public.user_roles for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists user_roles_delete_admin on public.user_roles;
create policy user_roles_delete_admin on public.user_roles for delete
  using (public.is_admin());
