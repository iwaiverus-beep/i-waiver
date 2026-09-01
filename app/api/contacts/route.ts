import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";
import { jsonError, readJson, text } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The lender's address book.
 *
 * Unlike everything touching the agreement graph, this runs on the caller's own
 * client under RLS rather than the service role. A contact list is not evidence —
 * it proves nothing about anything — so the owner-scoped policy on the table is
 * the whole of the authorisation, and there is no server-side check to duplicate.
 */

type Body = {
  display_name?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
  source?: unknown;
};

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const supabase = await userClient();
    const { data, error } = await supabase
      .from("contacts")
      .select("id, display_name, email, phone, notes, source, last_used_at")
      .is("archived_at", null)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("display_name");

    if (error) throw new Error(error.message);
    return NextResponse.json({ contacts: data ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const body = await readJson<Body>(request);

    const displayName = text(body.display_name, 120);
    const email = text(body.email, 320)?.toLowerCase() ?? null;
    const phone = text(body.phone, 40);

    if (!displayName) {
      return NextResponse.json({ error: "Give them a name." }, { status: 400 });
    }
    if (!email && !phone) {
      return NextResponse.json(
        { error: "An email or a phone number — otherwise there is no way to send them anything." },
        { status: 400 },
      );
    }

    const source = body.source === "device" ? "device" : body.source === "agreement" ? "agreement" : "manual";

    const supabase = await userClient();
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        owner_user_id: user.id,
        display_name: displayName,
        email,
        phone,
        notes: text(body.notes, 500),
        source,
        // Saved on the way through creating an agreement means they have just
        // been lent to, which is exactly what the recency ordering is for.
        last_used_at: source === "agreement" ? new Date().toISOString() : null,
      })
      .select("id, display_name, email, phone, notes, source, last_used_at")
      .single();

    if (error) {
      // 23505 is the one-per-address index. Saving the same person twice is not
      // an error worth a red banner.
      if (error.code === "23505") {
        return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ contact: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
