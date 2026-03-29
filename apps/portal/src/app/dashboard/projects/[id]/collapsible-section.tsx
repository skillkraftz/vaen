"use client";

import { useState } from "react";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  testId?: string;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  testId,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div data-testid={testId}>
      <div
        className={`collapsible-header${open ? " open" : ""}`}
        onClick={() => setOpen(!open)}
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        <span className="collapsible-header-title">{title}</span>
        <span className="collapsible-header-icon">{open ? "\u25be" : "\u25b8"}</span>
      </div>
      {open && (
        <div className="collapsible-body" style={{ padding: "1rem 1.25rem" }}>
          {children}
        </div>
      )}
    </div>
  );
}
