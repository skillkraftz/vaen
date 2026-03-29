"use client";

import { WORKFLOW_STEPS, getWorkflowStep } from "@/lib/workflow-steps";

interface WorkflowStepIndicatorProps {
  status: string;
}

export function WorkflowStepIndicator({ status }: WorkflowStepIndicatorProps) {
  const currentStep = getWorkflowStep(status) ?? 1;

  return (
    <div data-testid="workflow-progress" style={{ padding: "0.5rem 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", overflowX: "auto" }}>
        {WORKFLOW_STEPS.map((ws) => {
          const isDone = ws.step < currentStep;
          const isCurrent = ws.step === currentStep;
          const isFuture = ws.step > currentStep;

          return (
            <div
              key={ws.step}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                flex: isCurrent ? "0 0 auto" : "0 0 auto",
              }}
            >
              {/* Step circle */}
              <div
                style={{
                  width: "1.5rem",
                  height: "1.5rem",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  background: isDone
                    ? "var(--color-success, #22c55e)"
                    : isCurrent
                      ? "var(--color-primary, #3b82f6)"
                      : "var(--color-border, #e5e7eb)",
                  color: isDone || isCurrent ? "#fff" : "var(--color-text-muted, #9ca3af)",
                  flexShrink: 0,
                }}
                title={`Step ${ws.step}: ${ws.label} — ${ws.description}`}
              >
                {isDone ? "\u2713" : ws.step}
              </div>

              {/* Label (only for current step on small screens, all on wide) */}
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: isCurrent ? 600 : 400,
                  color: isFuture ? "var(--color-text-muted, #9ca3af)" : "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                {ws.label}
              </span>

              {/* Connector line */}
              {ws.step < 10 && (
                <div
                  style={{
                    width: "0.75rem",
                    height: "2px",
                    background: isDone
                      ? "var(--color-success, #22c55e)"
                      : "var(--color-border, #e5e7eb)",
                    flexShrink: 0,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
