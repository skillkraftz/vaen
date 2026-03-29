alter table public.prospect_enrichments
  add column if not exists status text not null default 'completed'
    check (status in ('pending', 'completed', 'failed'));

alter table public.prospect_enrichments
  add column if not exists source_job_id uuid null references public.jobs(id) on delete set null;

alter table public.prospect_enrichments
  add column if not exists error_message text;

update public.prospect_enrichments
set status = 'completed'
where status is null;

create index if not exists idx_prospect_enrichments_prospect_status_created
  on public.prospect_enrichments(prospect_id, status, created_at desc);
