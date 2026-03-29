import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { bootstrapCurrentUserRole } from "@/lib/user-role-server";
import { roleSatisfies } from "@/lib/user-roles";

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const roleState = await bootstrapCurrentUserRole();

  return (
    <>
      <header className="header">
        <Link href="/dashboard" className="header-brand">
          vaen.space
        </Link>
        <nav className="header-nav">
          <Link href="/dashboard/prospects" className="text-sm text-muted">
            Prospects
          </Link>
          <Link href="/dashboard/campaigns" className="text-sm text-muted">
            Campaigns
          </Link>
          <Link href="/dashboard/settings/pricing" className="text-sm text-muted">
            Pricing
          </Link>
          <Link href="/dashboard/settings/outreach" className="text-sm text-muted">
            Outreach
          </Link>
          {roleState.role && roleSatisfies(roleState.role, "sales") && (
            <Link href="/dashboard/analytics" className="text-sm text-muted">
              Analytics
            </Link>
          )}
          {roleState.role === "admin" && (
            <Link href="/dashboard/approvals" className="text-sm text-muted">
              Approvals
            </Link>
          )}
          <span className="badge" data-testid="current-user-role">
            {roleState.role ?? "operator"}
          </span>
          <span className="header-email">{user.email}</span>
          <form action={signOut}>
            <button type="submit" className="btn btn-sm">
              Sign Out
            </button>
          </form>
        </nav>
      </header>
      <main className="page-center">{children}</main>
    </>
  );
}
