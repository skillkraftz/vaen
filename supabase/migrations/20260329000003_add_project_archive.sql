alter table public.projects
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null;

comment on column public.projects.archived_at
  is 'When set, the project is archived and hidden from the default active dashboard list.';

comment on column public.projects.archived_by
  is 'User who most recently archived the project.';
