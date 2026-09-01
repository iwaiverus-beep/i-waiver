import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser, userClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { jsonError, readJson, text } from "@/lib/http";
import { PHOTO_BUCKET, type AssetPhoto } from "@/lib/assets/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Photographs of a thing you lend.
 *
 * Two clients in one handler, which is unusual here and worth saying why.
 *
 * The ROW goes through the caller's own client, like every other write in
 * app/api/assets: `asset_photos_owner_all` is a supported path rather than a
 * second line of defence, because a photograph of a jet ski is not evidence.
 *
 * The OBJECT goes through the service client, because the asset-photos bucket has
 * no storage policies at all. That is the same posture the two private buckets
 * take — nobody may write directly — and it means the authorisation for an upload
 * is the ownership check below, done before the bytes are touched. The bucket
 * being publicly READABLE does not make it publicly writable, and the gap between
 * those two is this file.
 */

const MAX_PHOTOS = 6;
const MAX_BYTES = 5 * 1024 * 1024;

// Three formats, all of which every browser renders and none of which can carry a
// script. SVG is deliberately absent: it is a document, it executes, and it would
// be served from a public bucket on our own origin.
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

/**
 * Confirms this item is the caller's, and returns what is already on it.
 *
 * Read on the caller's own client, so the policy is the check: an id belonging to
 * somebody else simply does not come back. Archived items are excluded — an item
 * taken off the list should not keep gaining photographs.
 */
async function ownedAsset(
  supabase: Awaited<ReturnType<typeof userClient>>,
  assetId: string,
): Promise<AssetPhoto[]> {
  const { data } = await supabase
    .from("assets")
    .select("id, asset_photos (id, storage_path, alt, order_index)")
    .eq("id", assetId)
    .is("archived_at", null)
    .maybeSingle();

  if (!data) throw new TransitionRefused("That item is not on your list.");
  return ((data.asset_photos ?? []) as AssetPhoto[]).sort(
    (a, b) => a.order_index - b.order_index,
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const { id } = await params;
    const supabase = await userClient();
    const existing = await ownedAsset(supabase, id);

    if (existing.length >= MAX_PHOTOS) {
      throw new TransitionRefused(
        `That is the ${MAX_PHOTOS} photographs it will hold. Remove one to add another.`,
      );
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      throw new TransitionRefused("Pick a photograph to upload.");
    }

    const extension = ALLOWED.get(file.type);
    if (!extension) {
      throw new TransitionRefused("Photographs need to be a JPEG, a PNG or a WebP.");
    }
    if (file.size > MAX_BYTES) {
      throw new TransitionRefused("That photograph is over 5MB. A smaller one will load faster on a phone anyway.");
    }

    // Foldered by item so the objects for one thing are findable together, and
    // named with a fresh uuid rather than the uploaded filename — which arrives
    // from a browser, may collide, and may contain anything at all.
    const storagePath = `${id}/${randomUUID()}.${extension}`;

    const { error: uploadError } = await serviceClient()
      .storage.from(PHOTO_BUCKET)
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (uploadError) throw new Error(uploadError.message);

    const { data, error } = await supabase
      .from("asset_photos")
      .insert({
        asset_id: id,
        storage_path: storagePath,
        alt: text(form?.get("alt"), 200),
        order_index: existing.length,
      })
      .select("id, storage_path, alt, order_index")
      .single();

    if (error) {
      // The row is what makes an object findable. Without it the upload is an
      // orphan nothing will ever reference or clean up, so it goes back out.
      await serviceClient().storage.from(PHOTO_BUCKET).remove([storagePath]);
      throw new Error(error.message);
    }

    return NextResponse.json({ photo: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Reorders the gallery.
 *
 * Takes the whole order rather than a move, because the client already knows the
 * arrangement it is showing and sending it wholesale is the only version that
 * cannot drift from what the lender is looking at.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const { id } = await params;
    const supabase = await userClient();
    const existing = await ownedAsset(supabase, id);

    const body = await readJson<{ order?: unknown }>(request);
    const order = Array.isArray(body.order) ? body.order.map(String) : [];

    const known = new Set(existing.map((photo) => photo.id));
    if (order.length !== known.size || order.some((photoId) => !known.has(photoId))) {
      throw new TransitionRefused("That is not the set of photographs on this item.");
    }

    // Sequential rather than parallel: six rows at most, and a partial reorder is
    // easier to reason about when the failure is at a known position.
    for (const [index, photoId] of order.entries()) {
      const { error } = await supabase
        .from("asset_photos")
        .update({ order_index: index })
        .eq("id", photoId)
        .eq("asset_id", id);
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Removes one photograph, object and all.
 *
 * A real delete, unlike everything else in this codebase that archives instead.
 * The rule those follow exists because agreements reference those rows; nothing
 * references this one, and a lender who has taken down a photograph of their boat
 * means it should stop being served.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const { id } = await params;
    const photoId = new URL(request.url).searchParams.get("photo");
    if (!photoId) throw new TransitionRefused("Which photograph?");

    const supabase = await userClient();

    // Deleted through the policy, and the returned row is the proof it was
    // theirs — no separate ownership read, and no path to the object unless the
    // delete actually happened.
    const { data, error } = await supabase
      .from("asset_photos")
      .delete()
      .eq("id", photoId)
      .eq("asset_id", id)
      .select("storage_path")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });

    await serviceClient().storage.from(PHOTO_BUCKET).remove([data.storage_path]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
