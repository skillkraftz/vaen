-- Storage bucket for review screenshots.
-- Screenshots are uploaded by the worker after each review job.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-screenshots',
  'review-screenshots',
  false,
  10485760, -- 10MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- RLS policies: users can view screenshots for their own projects
create policy "Users can view own project screenshots"
  on storage.objects for select
  using (
    bucket_id = 'review-screenshots'
    and (storage.foldername(name))[1] in (
      select id::text from public.projects where user_id = auth.uid()
    )
  );

-- Service role (worker) can upload screenshots
create policy "Service role can upload screenshots"
  on storage.objects for insert
  with check (
    bucket_id = 'review-screenshots'
  );

-- Service role can delete old screenshots
create policy "Service role can delete screenshots"
  on storage.objects for delete
  using (
    bucket_id = 'review-screenshots'
  );
