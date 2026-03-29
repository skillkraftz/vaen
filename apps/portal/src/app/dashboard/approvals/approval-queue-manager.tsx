"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ApprovalRequest } from "@/lib/types";
import { summarizeApprovalRequest } from "@/lib/approval-model";
import { resolveApprovalRequestAction } from "./actions";

function ApprovalCard({
  request,
}: {
  request: ApprovalRequest;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resolve(decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const result = await resolveApprovalRequestAction(request.id, decision, note);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="card" data-testid={`approval-card-${request.id}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <strong>{request.request_type.replaceAll("_", " ")}</strong>
          <p className="text-sm text-muted">{summarizeApprovalRequest(request)}</p>
          <p className="text-sm text-muted">
            Requested {new Date(request.created_at).toLocaleString("en-US")}
          </p>
        </div>
        <span className="badge" data-testid={`approval-status-${request.status}`}>
          {request.status}
        </span>
      </div>

      <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
        <label className="form-label" htmlFor={`approval-note-${request.id}`}>Resolution note</label>
        <textarea
          id={`approval-note-${request.id}`}
          className="form-input"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional context for the requester"
          data-testid={`approval-note-${request.id}`}
        />
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {request.status === "pending" && (
            <>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={isPending}
                onClick={() => resolve("approved")}
                data-testid={`approval-approve-${request.id}`}
              >
                {isPending ? "Saving..." : "Approve"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={isPending}
                onClick={() => resolve("rejected")}
                data-testid={`approval-reject-${request.id}`}
              >
                {isPending ? "Saving..." : "Reject"}
              </button>
            </>
          )}
        </div>
        {request.resolution_note && (
          <p className="text-sm text-muted">{request.resolution_note}</p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--color-error)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function ApprovalQueueManager({
  pending,
  recent,
}: {
  pending: ApprovalRequest[];
  recent: ApprovalRequest[];
}) {
  return (
    <div className="section" data-testid="approvals-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1>Approvals</h1>
          <p className="text-sm text-muted">
            Pending approvals execute the requested action only after current state is revalidated.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gap: "0.75rem" }}>
        <section className="card" data-testid="pending-approvals-list">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Pending</h2>
          {pending.length === 0 ? (
            <p className="text-sm text-muted">No pending approval requests.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {pending.map((request) => (
                <ApprovalCard key={request.id} request={request} />
              ))}
            </div>
          )}
        </section>

        <section className="card" data-testid="recent-approvals-list">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Recent</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-muted">No resolved approvals yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {recent.map((request) => (
                <ApprovalCard key={request.id} request={request} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
