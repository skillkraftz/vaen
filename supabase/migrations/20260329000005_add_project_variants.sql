alter table public.projects
  add column variant_of uuid references public.projects(id) on delete set null,
  add column variant_label text;

create index if not exists projects_variant_of_idx on public.projects (variant_of);

comment on column public.projects.variant_of
  is 'Root/base project lineage id for duplicated project variants';
comment on column public.projects.variant_label
  is 'Operator-facing variant label such as Base, Package 1, Demo, or Renewal';
