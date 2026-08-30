import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATE = /^[A-Z]{2}$/;

type Payload = {
  email?: unknown;
  full_name?: unknown;
  party_type?: unknown;
  state?: unknown;
};

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Fail loudly in logs, vaguely to the caller: a misconfigured deployment is
  // our problem, and the shape of it is not something to advertise.
  if (!url || !serviceRole) {
    console.error(
      "waitlist: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    return NextResponse.json(
      { error: "Signups are temporarily unavailable." },
      { status: 503 },
    );
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = str(body.email, 320)?.toLowerCase() ?? null;
  if (!email || !EMAIL.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const partyType = str(body.party_type, 20);
  const state = str(body.state, 2)?.toUpperCase() ?? null;

  const row = {
    email,
    full_name: str(body.full_name, 120),
    party_type: partyType === "business" ? "business" : "individual",
    state: state && STATE.test(state) ? state : null,
    source: "public-site",
    user_agent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
  };

  // Service role, so this bypasses RLS. That is the only way in: `waitlist` has
  // RLS enabled with no policies and no grants to anon or authenticated.
  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from("waitlist").insert(row);

  if (error) {
    // 23505 is the unique index on lower(email). Signing up twice is not an
    // error worth showing anyone, and confirming it would leak list membership.
    if (error.code === "23505") {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    console.error("waitlist insert failed:", error.message);
    return NextResponse.json(
      { error: "Could not save your details. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
