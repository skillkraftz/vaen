-- Add durable provenance fields so review screenshots can be matched
-- exactly to on-disk files produced during a review run.

alter table public.assets
  add column if not exists checksum_sha256 text;

alter table public.assets
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.assets.checksum_sha256
  is 'SHA-256 of the uploaded file content, used to prove upload matches on-disk review output';

comment on column public.assets.metadata
  is 'Supplementary provenance for assets such as manifest paths, local file info, and review evidence';
