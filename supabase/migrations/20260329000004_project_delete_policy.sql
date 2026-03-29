create policy "Users can delete own projects"
  on public.projects for delete
  using (auth.uid() = user_id);
