import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);

  return NextResponse.json({
    ok: true,
    accepted: true,
    message: "Resend webhook scaffold is present but not wired to product behavior yet.",
    eventType: payload && typeof payload === "object" && "type" in payload ? payload.type : null,
  }, { status: 202 });
}
