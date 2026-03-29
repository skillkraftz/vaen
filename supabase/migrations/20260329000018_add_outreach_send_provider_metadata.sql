alter table public.outreach_sends
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

comment on column public.outreach_sends.provider_metadata is
  'Provider-facing sender config, tags, and future webhook correlation metadata for outbound sends.';
