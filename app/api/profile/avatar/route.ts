import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { jsonError } from "@/lib/http";
import { AVATAR_BUCKET, avatarUrl } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The profile picture.
 *
 * Same shape as app/api/assets/[id]/photos/route.ts, with one difference that
 * matters: the bucket is private (20260901000036), so nothing here hands back a
 * public URL. The caller gets a signed one, minted for them, expiring.
 *
 * The previous object is removed on every successful upload. There is exactly one
 * avatar per account and no history worth keeping — this is not an evidence
 * table, and an orphaned face in a bucket is a small privacy debt that compounds.
 */

const MAX_BYTES = 5 * 1024 * 1024;

// The same three formats the item gallery takes, and SVG is absent for the same
// reason: it is a document, it executes, and this one is rendered into the header
// of every page.
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      throw new TransitionRefused("Pick a picture to upload.");
    }

    const extension = ALLOWED.get(file.type);
    if (!extension) {
      throw new TransitionRefused("Pictures need to be a JPEG, a PNG or a WebP.");
    }
    if (file.size > MAX_BYTES) {
      throw new TransitionRefused(
        "That picture is over 5MB. It is going to be shown in a circle the size of a thumbnail — a smaller one will look the same and load faster.",
      );
    }

    const db = serviceClient();

    const { data: existing } = await db
      .from("profiles")
      .select("avatar_path")
      .eq("id", user.id)
      .maybeSingle();

    // Foldered by account, named with a fresh uuid rather than the uploaded
    // filename — which arrives from a browser and may contain anything at all.
    const storagePath = `${user.id}/${randomUUID()}.${extension}`;

    const { error: uploadError } = await db.storage
      .from(AVATAR_BUCKET)
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (uploadError) throw new Error(uploadError.message);

    const { error } = await db
      .from("profiles")
      .update({ avatar_path: storagePath })
      .eq("id", user.id);

    if (error) {
      // The row is what makes an object findable. Without it the upload is an
      // orphan nothing will ever reference or clean up, so it goes back out.
      await db.storage.from(AVATAR_BUCKET).remove([storagePath]);
      throw new Error(error.message);
    }

    if (existing?.avatar_path) {
      await db.storage.from(AVATAR_BUCKET).remove([existing.avatar_path]);
    }

    return NextResponse.json({
      avatar_path: storagePath,
      avatar_url: await avatarUrl(db, storagePath),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE() {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const db = serviceClient();

    const { data: existing } = await db
      .from("profiles")
      .select("avatar_path")
      .eq("id", user.id)
      .maybeSingle();

    // The column first. If the object outlives it that is a stray file; if the
    // column outlives the object, every page renders a broken image.
    const { error } = await db
      .from("profiles")
      .update({ avatar_path: null })
      .eq("id", user.id);

    if (error) throw new TransitionRefused(`Could not remove it: ${error.message}`);

    if (existing?.avatar_path) {
      await db.storage.from(AVATAR_BUCKET).remove([existing.avatar_path]);
    }

    return NextResponse.json({ avatar_path: null, avatar_url: null });
  } catch (error) {
    return jsonError(error);
  }
}
