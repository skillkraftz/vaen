-- Fix: allow authenticated users to create jobs for their own projects.
-- The original migration only had a SELECT policy, blocking portal-side inserts.

create policy "Users can create jobs for own projects"
  on public.jobs for insert
  with check (
    project_id in (
      select id from public.projects where user_id = auth.uid()
    )
  );
