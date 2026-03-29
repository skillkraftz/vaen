import Link from "next/link";
import { ProspectForm } from "./prospect-form";

export default function NewProspectPage() {
  return (
    <>
      <div style={{ marginBottom: "0.75rem" }}>
        <Link href="/dashboard/prospects" className="text-sm text-muted">
          &larr; Prospects
        </Link>
      </div>
      <ProspectForm />
    </>
  );
}
