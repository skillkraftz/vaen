-- Add final_request column to store the AI-improved client-request.json
-- imported after the Codex/OpenClaw handoff. When present, this takes
-- priority over draft_request for site generation.

alter table public.projects
  add column final_request jsonb;

comment on column public.projects.final_request is 'AI-improved client-request.json imported from Codex/OpenClaw handoff';
