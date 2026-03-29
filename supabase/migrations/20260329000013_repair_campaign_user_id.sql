do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'campaigns'
      and column_name = 'user_id'
      and udt_name <> 'uuid'
  ) then
    drop policy if exists "Users can view own campaigns" on public.campaigns;
    drop policy if exists "Users can create own campaigns" on public.campaigns;
    drop policy if exists "Users can update own campaigns" on public.campaigns;
    drop policy if exists "Users can delete own campaigns" on public.campaigns;

    alter table public.campaigns
      drop constraint if exists campaigns_user_id_fkey;

    alter table public.campaigns
      alter column user_id type uuid using user_id::uuid;

    alter table public.campaigns
      add constraint campaigns_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;

    create policy "Users can view own campaigns"
      on public.campaigns for select
      using (user_id = auth.uid());

    create policy "Users can create own campaigns"
      on public.campaigns for insert
      with check (user_id = auth.uid());

    create policy "Users can update own campaigns"
      on public.campaigns for update
      using (user_id = auth.uid())
      with check (user_id = auth.uid());

    create policy "Users can delete own campaigns"
      on public.campaigns for delete
      using (user_id = auth.uid());
  end if;
end $$;
