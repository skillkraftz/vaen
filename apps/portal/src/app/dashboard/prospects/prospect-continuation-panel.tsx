"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ContinuationRequest } from "@/lib/types";
import { continuePendingReviewAction } from "./actions";

interface ContinuationItem {
  request: ContinuationRequest;
  eligible: boolean;
  blockedReason: string | null;
}

export function ProspectContinuationPanel({ items }: { items: ContinuationItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function continueReview(requestId: string) {
    startTransition(async () => {
      const result = await continuePendingReviewAction(requestId);
      if (result.error) {
        // Error will be visible on refresh as blocked status
      }
      router.refresh();
    });
  }

  return (
    <div className="card" data-testid="prospect-continuation-panel" style={{ borderLeft: "3px solid var(--color-warning, #e68a00)" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Pending Continuation</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {items.map((item) => (
          <div key={item.request.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <strong style={{ fontSize: "0.85rem" }}>
                {item.request.request_type === "pending_review" ? "Review ready to continue" : item.request.request_type}
              </strong>
              <p className="text-sm text-muted">
                Created {new Date(item.request.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
              {item.blockedReason && (
                <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.25rem" }}>
                  {item.blockedReason}
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => continueReview(item.request.id)}
              disabled={isPending || !item.eligible}
              data-testid={`continuation-continue-${item.request.id}`}
            >
              {isPending ? "Continuing..." : "Continue Review"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
