-- Storage bucket for intake file uploads
-- Files are organized as: {user_id}/{project_id}/{filename}

insert into storage.buckets (id, name, public)
values ('intake-assets', 'intake-assets', false);

-- Authenticated users can upload to their own path prefix
create policy "Users can upload to own path"
  on storage.objects for insert
  with check (
    bucket_id = 'intake-assets'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can view files in their own path prefix
create policy "Users can view own files"
  on storage.objects for select
  using (
    bucket_id = 'intake-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete files in their own path prefix
create policy "Users can delete own files"
  on storage.objects for delete
  using (
    bucket_id = 'intake-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
