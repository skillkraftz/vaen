alter table public.projects
  add column client_id uuid references public.clients(id) on delete set null;

create index projects_client_id_idx on public.projects (client_id);

comment on column public.projects.client_id
  is 'Optional link to the owning client record. Null for legacy projects created before clients were introduced.';
