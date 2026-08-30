import { NextResponse } from "next/server";
import { agreementForActor, requireActor } from "@/lib/agreements/access";
import { DOCUMENTS_BUCKET } from "@/lib/agreements/lifecycle";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agreements/[id]/document
 *
 * Hands back a short-lived signed URL rather than proxying the bytes. The bucket is
 * private with no storage policies, so this route — after the participation check —
 * is the only way anyone reaches a document.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const actor = await requireActor();
    await agreementForActor(actor, id);

    const { data: document } = await actor.db
      .from("documents")
      .select("id, storage_key, sha256, rendered_at")
      .eq("agreement_id", id)
      .eq("kind", "agreement")
      .order("rendered_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!document) {
      return NextResponse.json(
        { error: "No document yet — it is produced when everyone has signed." },
        { status: 404 },
      );
    }

    const { data: signed, error } = await actor.db.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(document.storage_key, 300);

    if (error || !signed) {
      return NextResponse.json({ error: "Could not open the document." }, { status: 500 });
    }

    return NextResponse.json({
      url: signed.signedUrl,
      sha256: document.sha256,
      rendered_at: document.rendered_at,
      expires_in_seconds: 300,
    });
  } catch (error) {
    return jsonError(error);
  }
}
