-- Categorize assets by type and link them to revisions.

-- Distinguish uploaded source assets from generated/review outputs
alter table public.assets
  add column asset_type text not null default 'uploaded'
    check (asset_type in ('uploaded', 'generated', 'review_screenshot'));

-- Link generated assets and screenshots to their producing job
alter table public.assets
  add column source_job_id uuid references public.jobs(id);

comment on column public.assets.asset_type
  is 'uploaded = user upload, generated = site generation output, review_screenshot = review pipeline output';
comment on column public.assets.source_job_id
  is 'Job that produced this asset (for generated/review_screenshot assets)';

-- Junction table: which assets are selected for use in a revision
create table public.revision_assets (
  revision_id uuid references public.project_request_revisions(id) on delete cascade not null,
  asset_id uuid references public.assets(id) on delete cascade not null,
  role text not null default 'content'
    check (role in ('logo', 'hero', 'gallery', 'content', 'reference')),
  sort_order int not null default 0,
  primary key (revision_id, asset_id)
);

alter table public.revision_assets enable row level security;

create policy "Users can view revision assets for own projects"
  on public.revision_assets for select
  using (
    revision_id in (
      select r.id from public.project_request_revisions r
      join public.projects p on r.project_id = p.id
      where p.user_id = auth.uid()
    )
  );

create policy "Users can manage revision assets for own projects"
  on public.revision_assets for all
  using (
    revision_id in (
      select r.id from public.project_request_revisions r
      join public.projects p on r.project_id = p.id
      where p.user_id = auth.uid()
    )
  );
