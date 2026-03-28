import { NextRequest, NextResponse } from "next/server";
import { getSiteConfigDiagnostics } from "@/lib/site-config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const route = request.nextUrl.searchParams.get("route") ?? request.nextUrl.pathname;
  const diagnostics = getSiteConfigDiagnostics(route);
  return NextResponse.json(diagnostics, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
