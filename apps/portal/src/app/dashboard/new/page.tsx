"use client";

import { useActionState, useState, useRef } from "react";
import { createIntake } from "./actions";
import Link from "next/link";

function slugify(text: string): string {
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

export default function NewIntakePage() {
  const selectedFilesRef = useRef<File[]>([]);
  const [state, formAction, pending] = useActionState(
    async (prev: { error: string } | null, formData: FormData) => {
      // Inject accumulated files (native input is cleared after each pick)
      formData.delete("files");
      for (const file of selectedFilesRef.current) {
        formData.append("files", file);
      }
      return createIntake(prev, formData);
    },
    null,
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugEdited) {
      setSlug(slugify(value));
    }
  }

  function updateFiles(files: File[]) {
    setSelectedFiles(files);
    selectedFilesRef.current = files;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    const existing = new Set(selectedFiles.map((f) => f.name));
    updateFiles([...selectedFiles, ...incoming.filter((f) => !existing.has(f.name))]);
    // Reset input so the same file can be re-selected after removal
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeFile(index: number) {
    updateFiles(selectedFiles.filter((_, i) => i !== index));
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
          <div className="form-group">
            <label className="form-label" htmlFor="name">
              Project / Business Name *
            </label>
            <input
              id="name"
              name="name"
              className="form-input"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
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
              placeholder="Jane Smith"
            />
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}
          >
            <div className="form-group">
              <label className="form-label" htmlFor="contactEmail">
                Contact Email
              </label>
              <input
                id="contactEmail"
                name="contactEmail"
                type="email"
                className="form-input"
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
              placeholder="Any additional details about the project, client preferences, special requirements..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">Files</label>
            <div
              className="upload-area"
              onClick={() => fileInputRef.current?.click()}
            >
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
                {selectedFiles.map((file, i) => (
                  <li key={i} className="file-item">
                    <span className="file-item-name">{file.name}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span className="file-item-size">{formatSize(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
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
