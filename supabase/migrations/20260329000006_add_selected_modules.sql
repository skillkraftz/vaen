alter table public.projects
  add column selected_modules jsonb not null default '[]';

comment on column public.projects.selected_modules
  is 'Operator-confirmed module selections. Array of {id, config?} objects. Authoritative source for generation module selection.';
