import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  Prospect,
  ProspectSiteAnalysis,
  ProspectEnrichment,
  Client,
  Project,
  OutreachSend,
  Quote,
  QuoteLine,
  ProspectOutreachPackage,
  JobRecord,
  CampaignSequenceStep,
  ProspectReplyEvent,
} from "@/lib/types";
import { ProspectDetailActions } from "../prospect-detail-actions";
import { getProspectSendReadiness } from "@/lib/outreach-execution";
import { getOutreachConfigReadiness } from "@/lib/outreach-config";
import { readProspectSequenceState } from "@/lib/campaign-sequences";
import { getCurrentCampaignStep, getSequencePauseReason } from "@/lib/sequence-execution";
import { listContinuationRequests, isContinuationEligible, getContinuationBlockedReason } from "@/lib/continuation-helpers";
import type { ContinuationRequest } from "@/lib/types";
import { ProspectContinuationPanel } from "../prospect-continuation-panel";

function formatProspectStatus(status: Prospect["status"]) {
  return status.replaceAll("_", " ");
}

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: prospect }, { data: analyses }] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", id).single(),
    supabase.from("prospect_site_analyses").select("*").eq("prospect_id", id).order("created_at", { ascending: false }),
  ]);

  if (!prospect) notFound();

  const p = prospect as Prospect;
  const analysisList = (analyses ?? []) as ProspectSiteAnalysis[];
  const latestAnalysis = analysisList[0] ?? null;

  const [{ data: client }, { data: project }, { data: outreachPackages }, { data: sends }, { data: replies }, { data: enrichments }] = await Promise.all([
    p.converted_client_id
      ? supabase.from("clients").select("id, name").eq("id", p.converted_client_id).single()
      : Promise.resolve({ data: null }),
    p.converted_project_id
      ? supabase
          .from("projects")
          .select("id, name, slug, status, last_reviewed_revision_id")
          .eq("id", p.converted_project_id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from("prospect_outreach_packages")
      .select("*")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("outreach_sends")
      .select("*")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("prospect_reply_events")
      .select("*")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("prospect_enrichments")
      .select("*")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const linkedClient = client as Pick<Client, "id" | "name"> | null;
  const linkedProject = project as Pick<Project, "id" | "name" | "slug" | "status" | "last_reviewed_revision_id"> | null;
  const linkedCampaign = p.campaign_id
    ? ((await supabase.from("campaigns").select("id, name").eq("id", p.campaign_id).maybeSingle()).data as { id: string; name: string } | null)
    : null;
  const latestPackage = ((outreachPackages ?? [])[0] ?? null) as ProspectOutreachPackage | null;
  const sendHistory = (sends ?? []) as OutreachSend[];
  const replyHistory = (replies ?? []) as ProspectReplyEvent[];
  const latestEnrichment = ((enrichments ?? [])[0] ?? null) as ProspectEnrichment | null;
  const latestSend = sendHistory[0] ?? null;
  const latestReply = replyHistory[0] ?? null;
  const sequenceState = readProspectSequenceState(p.metadata);

  const [{ data: jobs }, { data: quotes }, { data: screenshots }, { data: sequenceSteps }] = await Promise.all([
    linkedProject
      ? supabase.from("jobs").select("*").eq("project_id", linkedProject.id).order("created_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] }),
    linkedProject
      ? supabase.from("quotes").select("*, lines:quote_lines(*)").eq("project_id", linkedProject.id).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] }),
    linkedProject
      ? supabase
          .from("assets")
          .select("id, file_name, storage_path, created_at")
          .eq("project_id", linkedProject.id)
          .eq("asset_type", "review_screenshot")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    p.campaign_id
      ? supabase
          .from("campaign_sequence_steps")
          .select("*")
          .eq("campaign_id", p.campaign_id)
          .order("step_number", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const latestJob = ((jobs ?? [])[0] ?? null) as JobRecord | null;
  const latestQuote = ((quotes ?? [])[0] ?? null) as (Quote & { lines: QuoteLine[] }) | null;
  const screenshotItems = (screenshots ?? []) as Array<{ id: string; file_name: string; storage_path: string; created_at: string }>;
  const campaignSequenceSteps = (sequenceSteps ?? []) as CampaignSequenceStep[];
  const automationLevel = typeof p.metadata?.automation_level === "string"
    ? p.metadata.automation_level
    : "convert_only";
  const automationBlockedReason = typeof p.metadata?.automation_blocked_reason === "string"
    ? p.metadata.automation_blocked_reason
    : null;
  const readiness = {
    analyzed: latestAnalysis?.status === "completed",
    converted: !!linkedProject,
    screenshotsReady: screenshotItems.length > 0,
    quoteReady: !!latestQuote,
    outreachPackageReady: !!latestPackage,
  };
  const configReadiness = getOutreachConfigReadiness();
  const sendReadiness = getProspectSendReadiness({
    prospect: p,
    outreachPackage: latestPackage,
    configReadiness,
  });
  const sequencePauseReason = getSequencePauseReason(p);
  const currentSequenceStep = getCurrentCampaignStep({
    sequenceSteps: campaignSequenceSteps,
    sequenceState,
  });

  const continuationRequests = await listContinuationRequests(supabase, {
    prospectId: id,
  }) as ContinuationRequest[];

  const pendingContinuations = continuationRequests.filter((r) => r.status === "pending");
  const continuationItems = pendingContinuations.map((r) => ({
    request: r,
    eligible: linkedProject ? isContinuationEligible(linkedProject.status, r.request_type) : false,
    blockedReason: linkedProject ? getContinuationBlockedReason(linkedProject.status, r.request_type) : "No linked project.",
  }));

  return (
    <>
      <div style={{ marginBottom: "0.75rem" }}>
        <Link href="/dashboard/prospects" className="text-sm text-muted">
          &larr; Prospects
        </Link>
      </div>

      <div className="section" data-testid="prospect-detail-page">
        <div className="section-header" style={{ marginBottom: "0.75rem" }}>
          <div>
            <h1 style={{ marginBottom: "0.25rem" }}>{p.company_name}</h1>
            <p className="text-sm text-muted">{p.website_url}</p>
          </div>
          <span className="badge" data-testid="prospect-status-badge">
            {formatProspectStatus(p.status)}
          </span>
        </div>

        <ProspectDetailActions prospect={p} />
      </div>

      {continuationItems.length > 0 && (
        <div className="section">
          <ProspectContinuationPanel items={continuationItems} />
        </div>
      )}

      <div className="section">
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Prospect Details</h2>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <div><strong>Contact:</strong> {p.contact_name ?? "Unknown"}</div>
            <div><strong>Email:</strong> {p.contact_email ?? "Unknown"}</div>
            <div><strong>Phone:</strong> {p.contact_phone ?? "Unknown"}</div>
            <div><strong>Source:</strong> {p.source ?? "Manual"}</div>
            <div>
              <strong>Campaign:</strong>{" "}
              {linkedCampaign ? <Link href={`/dashboard/campaigns/${linkedCampaign.id}`}>{linkedCampaign.name}</Link> : (p.campaign ?? "None")}
            </div>
            <div><strong>Outreach Summary:</strong> {p.outreach_summary ?? "Not generated yet"}</div>
            <div><strong>Outreach Status:</strong> {p.outreach_status ?? "draft"}</div>
            <div><strong>Latest Reply:</strong> {latestReply ? new Date(latestReply.created_at).toLocaleString("en-US") : "None recorded"}</div>
            <div><strong>Outreach Config:</strong> {configReadiness.ready ? "ready" : "blocked"}</div>
            <div><strong>Notes:</strong> {p.notes ?? "None"}</div>
            <div><strong>Automation Level:</strong> {automationLevel}</div>
            <div><strong>Last Sent:</strong> {p.last_outreach_sent_at ? new Date(p.last_outreach_sent_at).toLocaleString("en-US") : "Never"}</div>
            <div><strong>Next Follow-up Due:</strong> {p.next_follow_up_due_at ? new Date(p.next_follow_up_due_at).toLocaleDateString("en-US") : "Not scheduled"}</div>
            <div><strong>Follow-up Count:</strong> {p.follow_up_count ?? 0}</div>
            {automationBlockedReason && (
              <div><strong>Automation Note:</strong> {automationBlockedReason}</div>
            )}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card" data-testid="prospect-sequence-state">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Sequence State</h2>
          {p.campaign_id && campaignSequenceSteps.length > 0 ? (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <div><strong>Current Step:</strong> {currentSequenceStep.step ? `${currentSequenceStep.step.step_number} · ${currentSequenceStep.step.label}` : "Complete"}</div>
              <div><strong>Due Status:</strong> {sequencePauseReason ? "paused" : currentSequenceStep.due ? "due now" : "scheduled"}</div>
              <div><strong>Paused:</strong> {sequencePauseReason ? `yes (${sequencePauseReason})` : "no"}</div>
              <div><strong>Steps Sent:</strong> {sequenceState?.steps.filter((step) => !!step.sent_at).length ?? 0}</div>
              {sequenceState?.steps.length ? (
                <div style={{ marginTop: "0.5rem" }}>
                  {sequenceState.steps.map((step) => (
                    <p key={step.step_number} className="text-sm text-muted">
                      Step {step.step_number}: {step.sent_at
                        ? `sent ${new Date(step.sent_at).toLocaleString("en-US")}`
                        : step.due_at
                          ? `due ${new Date(step.due_at).toLocaleString("en-US")}`
                          : "pending"}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">Sequence has not started yet for this prospect.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Assign the prospect to a campaign with sequence steps to start follow-up tracking.</p>
          )}
        </div>
      </div>

      <div className="section">
        <div className="card" data-testid="prospect-enrichment-panel">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Sales Enrichment</h2>
          {latestEnrichment ? (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <strong>Business Summary</strong>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: "0.35rem" }}>{latestEnrichment.business_summary ?? "Not generated yet"}</pre>
              </div>
              <div>
                <strong>Recommended Package</strong>
                <p className="text-sm text-muted">{latestEnrichment.recommended_package ?? "Not generated yet"}</p>
              </div>
              <div>
                <strong>Opportunity Analysis</strong>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: "0.35rem" }}>{latestEnrichment.opportunity_summary ?? "Not generated yet"}</pre>
              </div>
              <div>
                <strong>Missing Pieces</strong>
                {latestEnrichment.missing_pieces.length > 0 ? (
                  <ul className="text-sm text-muted" style={{ paddingLeft: "1rem", marginTop: "0.35rem" }}>
                    {latestEnrichment.missing_pieces.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No obvious missing pieces flagged.</p>
                )}
              </div>
              <div>
                <strong>Offer Positioning</strong>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: "0.35rem" }}>{latestEnrichment.offer_positioning ?? "Not generated yet"}</pre>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Generate enrichment to turn raw site analysis into a sales-ready prospect summary.</p>
          )}
        </div>
      </div>

      <div className="section">
        <div className="card" data-testid="prospect-analysis-panel">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Website Analysis</h2>
          {latestAnalysis ? (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <div><strong>Source:</strong> {latestAnalysis.analysis_source}</div>
              <div><strong>Status:</strong> {latestAnalysis.status}</div>
              <div><strong>Site Title:</strong> {latestAnalysis.site_title ?? "Unknown"}</div>
              <div><strong>Meta Description:</strong> {latestAnalysis.meta_description ?? "Unknown"}</div>
              <div><strong>Primary H1:</strong> {latestAnalysis.primary_h1 ?? "Unknown"}</div>
              <div><strong>Excerpt:</strong> {latestAnalysis.content_excerpt ?? "None"}</div>
              {latestAnalysis.error_message && (
                <div className="text-sm" style={{ color: "var(--color-error)" }}>
                  {latestAnalysis.error_message}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No analysis has been run yet.</p>
          )}
        </div>
      </div>

      <div className="section">
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Conversion Links</h2>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <div>
              <strong>Client:</strong>{" "}
              {linkedClient ? <Link href="/dashboard">{linkedClient.name}</Link> : "Not created yet"}
            </div>
            <div>
              <strong>Project:</strong>{" "}
              {linkedProject ? <Link href={`/dashboard/projects/${linkedProject.id}`}>{linkedProject.name}</Link> : "Not created yet"}
            </div>
            {linkedProject && (
              <>
                <div><strong>Latest Project Status:</strong> {linkedProject.status}</div>
                <div><strong>Latest Job:</strong> {latestJob ? `${latestJob.job_type} · ${latestJob.status}` : "No jobs yet"}</div>
                <div><strong>Review Screenshots:</strong> {screenshotItems.length > 0 ? `${screenshotItems.length} available` : "Not available yet"}</div>
                <div><strong>Latest Quote:</strong> {latestQuote ? `${latestQuote.status} · #${latestQuote.quote_number}` : "No quote yet"}</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card" data-testid="prospect-readiness-panel">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Readiness</h2>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <div><strong>Analysis:</strong> {readiness.analyzed ? "ready" : "pending"}</div>
            <div><strong>Project Conversion:</strong> {readiness.converted ? "ready" : "pending"}</div>
            <div><strong>Screenshots:</strong> {readiness.screenshotsReady ? "ready" : "pending"}</div>
            <div><strong>Quote:</strong> {readiness.quoteReady ? "ready" : "pending"}</div>
            <div><strong>Outreach Package:</strong> {readiness.outreachPackageReady ? "ready" : "pending"}</div>
            <div><strong>Outreach Config:</strong> {configReadiness.ready ? "ready" : "blocked"}</div>
            <div><strong>Send Readiness:</strong> {sendReadiness.ready ? "ready" : "blocked"}</div>
          </div>
          {!sendReadiness.ready && (
            <div style={{ marginTop: "0.75rem" }}>
              {sendReadiness.issues.map((issue) => (
                <p key={issue} className="text-sm" style={{ color: "var(--color-warning)" }}>
                  {issue}
                </p>
              ))}
              <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
                Review environment readiness in{" "}
                <Link href="/dashboard/settings/outreach">Outreach settings</Link>.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <div className="card" data-testid="prospect-outreach-package">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Outreach Package</h2>
          {latestPackage ? (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <strong>Offer Summary</strong>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: "0.35rem" }}>{latestPackage.offer_summary}</pre>
              </div>
              <div>
                <strong>Email Subject</strong>
                <p className="text-sm text-muted" data-testid="prospect-email-subject">{latestPackage.email_subject ?? "Not prepared yet"}</p>
              </div>
              <div>
                <strong>Email Body</strong>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: "0.35rem" }} data-testid="prospect-email-body">{latestPackage.email_body ?? "Not prepared yet"}</pre>
              </div>
              <div>
                <strong>Attachment Hooks</strong>
                <p className="text-sm text-muted">
                  {screenshotItems.length > 0
                    ? `${screenshotItems.length} review screenshots available to link or attach later`
                    : "No review screenshots available yet"}
                </p>
              </div>
              <div>
                <strong>Send Readiness</strong>
                <p className="text-sm text-muted">
                  {sendReadiness.ready ? "Subject, body, project, and recipient are ready." : sendReadiness.issues.join(" ")}
                </p>
                {!configReadiness.ready && (
                  <p className="text-sm text-muted">
                    Sending is blocked until outreach configuration is complete.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Generate an outreach package to prepare the offer summary and email draft.</p>
          )}
        </div>
      </div>

      <div className="section">
        <div className="card" data-testid="prospect-reply-history">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Reply History</h2>
          {replyHistory.length === 0 ? (
            <p className="text-sm text-muted">No replies have been recorded yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {replyHistory.map((reply) => (
                <div key={reply.id} style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                    <strong>{reply.reply_summary ?? "Manual reply recorded"}</strong>
                    <span className="text-sm text-muted">{new Date(reply.created_at).toLocaleString("en-US")}</span>
                  </div>
                  {reply.reply_note && (
                    <p className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>{reply.reply_note}</p>
                  )}
                  {reply.outreach_send_id && (
                    <p className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>Linked send: {reply.outreach_send_id}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <div className="card" data-testid="prospect-send-history">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Outreach History</h2>
          {latestSend && (
            <p className="text-sm text-muted" style={{ marginBottom: "0.75rem" }}>
              Latest send: {latestSend.status} to {latestSend.recipient_email} on {new Date(latestSend.created_at).toLocaleString("en-US")}
            </p>
          )}
          {sendHistory.length === 0 ? (
            <p className="text-sm text-muted">No outreach has been sent yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {sendHistory.map((send) => (
                <div key={send.id} style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                    <strong>{send.status}</strong>
                    <span className="text-sm text-muted">{new Date(send.created_at).toLocaleString("en-US")}</span>
                  </div>
                  <p className="text-sm text-muted">{send.recipient_email}</p>
                  <p className="text-sm text-muted">{send.subject}</p>
                  {send.error_message && (
                    <p className="text-sm" style={{ color: "var(--color-error)" }}>{send.error_message}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
