"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Client } from "@/lib/types";
import { createIntake } from "./actions";

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ProjectFieldKey =
  | "name"
  | "businessType"
  | "contactName"
  | "contactEmail"
  | "contactPhone"
  | "notes";

export function NewIntakeForm({ clients }: { clients: Client[] }) {
  const selectedFilesRef = useRef<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, formAction, pending] = useActionState(
    async (prev: { error: string } | null, formData: FormData) => {
      formData.delete("files");
      for (const file of selectedFilesRef.current) {
        formData.append("files", file);
      }
      return createIntake(prev, formData);
    },
    null,
  );

  const [clientMode, setClientMode] = useState<"new" | "existing">("new");
  const [selectedClientId, setSelectedClientId] = useState("");

  const [clientName, setClientName] = useState("");
  const [clientBusinessType, setClientBusinessType] = useState("");
  const [clientContactName, setClientContactName] = useState("");
  const [clientContactEmail, setClientContactEmail] = useState("");
  const [clientContactPhone, setClientContactPhone] = useState("");
  const [clientNotes, setClientNotes] = useState("");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [businessType, setBusinessType] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [projectOverrides, setProjectOverrides] = useState<Record<ProjectFieldKey, boolean>>({
    name: false,
    businessType: false,
    contactName: false,
    contactEmail: false,
    contactPhone: false,
    notes: false,
  });

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );

  function updateFiles(files: File[]) {
    setSelectedFiles(files);
    selectedFilesRef.current = files;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    const existing = new Set(selectedFiles.map((file) => file.name));
    updateFiles([...selectedFiles, ...incoming.filter((file) => !existing.has(file.name))]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeFile(index: number) {
    updateFiles(selectedFiles.filter((_, i) => i !== index));
  }

  function markProjectFieldEdited(field: ProjectFieldKey) {
    setProjectOverrides((prev) => ({ ...prev, [field]: true }));
  }

  function syncProjectFromClient(seed: {
    name?: string | null;
    businessType?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    notes?: string | null;
  }) {
    if (!projectOverrides.name && seed.name != null) {
      setName(seed.name);
      if (!slugEdited) setSlug(slugify(seed.name));
    }
    if (!projectOverrides.businessType && seed.businessType != null) {
      setBusinessType(seed.businessType);
    }
    if (!projectOverrides.contactName && seed.contactName != null) {
      setContactName(seed.contactName);
    }
    if (!projectOverrides.contactEmail && seed.contactEmail != null) {
      setContactEmail(seed.contactEmail);
    }
    if (!projectOverrides.contactPhone && seed.contactPhone != null) {
      setContactPhone(seed.contactPhone);
    }
    if (!projectOverrides.notes && seed.notes != null) {
      setNotes(seed.notes);
    }
  }

  function handleNewClientChange(
    field: "name" | "businessType" | "contactName" | "contactEmail" | "contactPhone" | "notes",
    value: string,
  ) {
    if (field === "name") {
      setClientName(value);
      syncProjectFromClient({ name: value });
      return;
    }
    if (field === "businessType") {
      setClientBusinessType(value);
      syncProjectFromClient({ businessType: value });
      return;
    }
    if (field === "contactName") {
      setClientContactName(value);
      syncProjectFromClient({ contactName: value });
      return;
    }
    if (field === "contactEmail") {
      setClientContactEmail(value);
      syncProjectFromClient({ contactEmail: value });
      return;
    }
    if (field === "contactPhone") {
      setClientContactPhone(value);
      syncProjectFromClient({ contactPhone: value });
      return;
    }
    setClientNotes(value);
    syncProjectFromClient({ notes: value });
  }

  function handleExistingClientSelect(clientId: string) {
    setSelectedClientId(clientId);
    const client = clientsById.get(clientId);
    if (!client) return;

    syncProjectFromClient({
      name: client.name,
      businessType: client.business_type,
      contactName: client.contact_name,
      contactEmail: client.contact_email,
      contactPhone: client.contact_phone,
      notes: client.notes,
    });
  }

  return (
    <>
      <div className="section-header">
        <h1>New Intake</h1>
        <Link href="/dashboard" className="btn btn-sm">
          Cancel
        </Link>
      </div>

      <div className="card">
        {state?.error && <div className="alert alert-error">{state.error}</div>}

        <form action={formAction} data-testid="new-intake-form">
          <input type="hidden" name="clientMode" value={clientMode} />

          <div className="section-label" style={{ marginBottom: "0.75rem" }}>
            Client
          </div>

          <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
            <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
              <label className="text-sm" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="radio"
                  name="clientModeToggle"
                  checked={clientMode === "new"}
                  onChange={() => setClientMode("new")}
                />
                New Client
              </label>
              <label className="text-sm" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="radio"
                  name="clientModeToggle"
                  checked={clientMode === "existing"}
                  onChange={() => setClientMode("existing")}
                />
                Existing Client
              </label>
            </div>

            {clientMode === "existing" ? (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="existingClientId">
                  Existing Client
                </label>
                <select
                  id="existingClientId"
                  name="existingClientId"
                  className="form-input"
                  value={selectedClientId}
                  onChange={(e) => handleExistingClientSelect(e.target.value)}
                >
                  <option value="">Select a client...</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                      {client.business_type ? ` · ${client.business_type}` : ""}
                    </option>
                  ))}
                </select>
                <p className="form-hint">
                  Choosing an existing client prefills the project snapshot below. You can still edit the project fields before creating it.
                </p>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label" htmlFor="clientName">
                    Client Name
                  </label>
                  <input
                    id="clientName"
                    name="clientName"
                    className="form-input"
                    value={clientName}
                    onChange={(e) => handleNewClientChange("name", e.target.value)}
                    placeholder="Flower City Painting"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="clientBusinessType">
                    Business Type
                  </label>
                  <input
                    id="clientBusinessType"
                    name="clientBusinessType"
                    className="form-input"
                    value={clientBusinessType}
                    onChange={(e) => handleNewClientChange("businessType", e.target.value)}
                    placeholder="Painting contractor, Landscaper, Plumber, etc."
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="clientContactName">
                      Contact Name
                    </label>
                    <input
                      id="clientContactName"
                      name="clientContactName"
                      className="form-input"
                      value={clientContactName}
                      onChange={(e) => handleNewClientChange("contactName", e.target.value)}
                      placeholder="Jane Smith"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="clientContactEmail">
                      Contact Email
                    </label>
                    <input
                      id="clientContactEmail"
                      name="clientContactEmail"
                      type="email"
                      className="form-input"
                      value={clientContactEmail}
                      onChange={(e) => handleNewClientChange("contactEmail", e.target.value)}
                      placeholder="jane@example.com"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="clientContactPhone">
                    Contact Phone
                  </label>
                  <input
                    id="clientContactPhone"
                    name="clientContactPhone"
                    type="tel"
                    className="form-input"
                    value={clientContactPhone}
                    onChange={(e) => handleNewClientChange("contactPhone", e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="clientNotes">
                    Client Notes
                  </label>
                  <textarea
                    id="clientNotes"
                    name="clientNotes"
                    className="form-input"
                    rows={3}
                    value={clientNotes}
                    onChange={(e) => handleNewClientChange("notes", e.target.value)}
                    placeholder="High-level client notes that should carry into the project by default."
                  />
                </div>
              </>
            )}
          </div>

          <div className="section-label" style={{ marginBottom: "0.75rem" }}>
            Project
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="name">
              Project / Business Name *
            </label>
            <input
              id="name"
              name="name"
              className="form-input"
              value={name}
              onChange={(e) => {
                const value = e.target.value;
                setName(value);
                markProjectFieldEdited("name");
                if (!slugEdited) {
                  setSlug(slugify(value));
                }
              }}
              required
              placeholder="Flower City Painting"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="slug">
              Slug *
            </label>
            <input
              id="slug"
              name="slug"
              className="form-input text-mono"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="flower-city-painting"
            />
            <p className="form-hint">
              Lowercase letters, numbers, hyphens. Used as the target identifier.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="businessType">
              Business Type
            </label>
            <input
              id="businessType"
              name="businessType"
              className="form-input"
              value={businessType}
              onChange={(e) => {
                setBusinessType(e.target.value);
                markProjectFieldEdited("businessType");
              }}
              placeholder="Painting contractor, Landscaper, Plumber, etc."
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="contactName">
              Contact Name
            </label>
            <input
              id="contactName"
              name="contactName"
              className="form-input"
              value={contactName}
              onChange={(e) => {
                setContactName(e.target.value);
                markProjectFieldEdited("contactName");
              }}
              placeholder="Jane Smith"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="form-group">
              <label className="form-label" htmlFor="contactEmail">
                Contact Email
              </label>
              <input
                id="contactEmail"
                name="contactEmail"
                type="email"
                className="form-input"
                value={contactEmail}
                onChange={(e) => {
                  setContactEmail(e.target.value);
                  markProjectFieldEdited("contactEmail");
                }}
                placeholder="jane@example.com"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="contactPhone">
                Contact Phone
              </label>
              <input
                id="contactPhone"
                name="contactPhone"
                type="tel"
                className="form-input"
                value={contactPhone}
                onChange={(e) => {
                  setContactPhone(e.target.value);
                  markProjectFieldEdited("contactPhone");
                }}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              className="form-input"
              rows={4}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                markProjectFieldEdited("notes");
              }}
              placeholder="Any additional details about the project, client preferences, special requirements..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">Files</label>
            <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                accept="image/*,audio/*,.pdf,.txt,.doc,.docx"
              />
              <p>Click to select files</p>
              <p className="text-sm text-muted mt-1">
                Images, audio, PDFs, text files (max 10 MB total)
              </p>
            </div>

            {selectedFiles.length > 0 && (
              <ul className="file-list">
                {selectedFiles.map((file, index) => (
                  <li key={index} className="file-item">
                    <span className="file-item-name">{file.name}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span className="file-item-size">{formatSize(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="btn btn-sm"
                        style={{ padding: "0.2rem 0.4rem" }}
                      >
                        x
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={pending}
            style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
            data-testid="create-intake-submit"
          >
            {pending ? "Creating intake..." : "Create Intake"}
          </button>
        </form>
      </div>
    </>
  );
}
