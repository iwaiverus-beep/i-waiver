import { NextResponse } from "next/server";
import { requestContext } from "@/lib/audit";
import { createDraftAgreement } from "@/lib/agreements/create";
import {
  ensureIndividualOriginator,
  originatorKind,
  requireActor,
} from "@/lib/agreements/access";
import { EMAIL_PATTERN, jsonError, readJson, text } from "@/lib/http";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { parseDollarsToCents, asIanaZone } from "@/lib/format";
import { markAccepted, requestForActor } from "@/lib/intake/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  /** One saved item. Superseded by `asset_ids`; still accepted. */
  asset_id?: unknown;
  /** Saved items in schedule order. The lender's order, so it is preserved. */
  asset_ids?: unknown;
  /** Set when this draft is a lender accepting a request that came in off a code. */
  request_id?: unknown;
  /** One item described inline, appended after any saved ones. */
  asset?: {
    asset_class?: unknown;
    description?: unknown;
    identifier?: unknown;
    declared_value?: unknown;
    year?: unknown;
    make?: unknown;
    model?: unknown;
  };
  borrower_name?: unknown;
  borrower_email?: unknown;
  lender_name?: unknown;
  starts_at?: unknown;
  time_zone?: unknown;
  ends_at?: unknown;
  jurisdiction?: unknown;
  activity_class?: unknown;
  cover_requested?: unknown;
};

const ASSET_CLASSES = ["pwc", "boat", "trailer", "vehicle", "equipment", "other"];

/**
 * POST /api/agreements — create a draft.
 *
 * A draft is created with both signers already on it. An agreement with one party
 * is not a thing this product has any use for, and deferring the borrower means
 * every later step has to cope with a shape that should never exist.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const body = await readJson<Body>(request);
    const context = requestContext(request);

    const borrowerName = text(body.borrower_name, 120);
    const borrowerEmail = text(body.borrower_email, 320)?.toLowerCase() ?? null;
    const startsAt = text(body.starts_at, 40);
    const endsAt = text(body.ends_at, 40);
    const jurisdiction = text(body.jurisdiction, 2)?.toUpperCase() ?? null;
    // Validated, not trusted. An unknown zone name would be accepted by the
    // column and then throw inside Intl at render time, which is a broken
    // document rather than a rejected request.
    const timeZone = asIanaZone(text(body.time_zone, 64));
    const activityClass = text(body.activity_class, 60) ?? "personal_watercraft";

    if (!borrowerName) throw new TransitionRefused("Who is borrowing it?");
    if (!borrowerEmail || !EMAIL_PATTERN.test(borrowerEmail)) {
      throw new TransitionRefused("The borrower needs a valid email address.");
    }
    if (!startsAt || !endsAt) throw new TransitionRefused("When does the loan run?");
    if (new Date(endsAt) <= new Date(startsAt)) {
      throw new TransitionRefused("The loan has to end after it starts.");
    }
    if (!jurisdiction || !/^[A-Z]{2}$/.test(jurisdiction)) {
      throw new TransitionRefused("Which state does the activity happen in?");
    }

    const { db, userId } = actor;

    // The lender's own name on the document. Their profile if they have set one,
    // otherwise what they typed on the form.
    const { data: profile } = await db
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    const lenderName = profile?.full_name ?? text(body.lender_name, 120);
    if (!lenderName) {
      throw new TransitionRefused("Add your own name before creating an agreement.");
    }

    const { data: lenderAuth } = await db.auth.admin.getUserById(userId);
    const lenderEmail = lenderAuth?.user?.email ?? null;
    if (!lenderEmail) throw new TransitionRefused("Your account has no email address.");

    const originatorId = await ensureIndividualOriginator(db, userId);
    const kind = await originatorKind(db, originatorId);

    // --- The items -----------------------------------------------------------
    //
    // A bundle is built from two sources and both may be used at once: things
    // already saved to the lender's list, and one thing described inline on the
    // form. The order is the lender's — it becomes Schedule A, and the lead item
    // is the one the agreement's own `asset_id` points at.
    const savedIds = Array.isArray(body.asset_ids)
      ? body.asset_ids
          .map((value) => text(value, 40))
          .filter((value): value is string => value !== null)
      : [];

    // A lone `asset_id` is the pre-bundle shape. Accepted so that anything still
    // sending it keeps working.
    const singleId = text(body.asset_id, 40);
    if (singleId && !savedIds.includes(singleId)) savedIds.unshift(singleId);

    // Deduplicate rather than refuse. Lending the same jet ski twice on one
    // agreement is a mis-tap, and `agreement_assets` has a composite primary key
    // that would otherwise turn it into a database error the lender cannot read.
    const orderedIds = [...new Set(savedIds)];

    if (orderedIds.length > 0) {
      const { data: owned, error: ownedError } = await db
        .from("assets")
        .select("id")
        .in("id", orderedIds)
        .eq("owner_originator_id", originatorId)
        .is("archived_at", null);

      // Checked, not ignored. A failed query returns no rows, and treating that
      // as "none of these are yours" reports a database fault as an ownership
      // problem — which is how a missing `owner_originator_id` column spent an
      // afternoon looking like a permissions bug. An authorisation check that
      // cannot run has not passed and has not failed; it has broken, and it must
      // say so in those terms.
      if (ownedError) {
        throw new Error(`Could not verify who owns these items: ${ownedError.message}`);
      }

      const ownedIds = new Set((owned ?? []).map((row) => row.id));
      const stranger = orderedIds.find((id) => !ownedIds.has(id));
      if (stranger) {
        throw new TransitionRefused(
          orderedIds.length === 1
            ? "That asset is not yours."
            : "One of those items is not yours, or has been removed from your list.",
        );
      }
    }

    // Something typed into the form rather than picked. Saved to the lender's
    // list on the way past, which is what makes the second loan a tick box.
    const description = text(body.asset?.description, 200);
    if (description) {
      const assetClass = text(body.asset?.asset_class, 20) ?? "other";
      const declaredValue =
        typeof body.asset?.declared_value === "string"
          ? parseDollarsToCents(body.asset.declared_value)
          : typeof body.asset?.declared_value === "number"
            ? Math.round(body.asset.declared_value * 100)
            : null;

      const yearValue = Number(body.asset?.year);

      const { data: asset, error } = await db
        .from("assets")
        .insert({
          owner_originator_id: originatorId,
          asset_class: ASSET_CLASSES.includes(assetClass) ? assetClass : "other",
          description,
          identifier: text(body.asset?.identifier, 60),
          declared_value_cents: declaredValue,
          year: Number.isInteger(yearValue) && yearValue > 1900 ? yearValue : null,
          make: text(body.asset?.make, 60),
          model: text(body.asset?.model, 60),
        })
        .select("id")
        .single();

      if (error || !asset) {
        throw new TransitionRefused(`Could not save the asset: ${error?.message}`);
      }
      orderedIds.push(asset.id);
    }

    if (orderedIds.length === 0) {
      throw new TransitionRefused("Describe what is being lent.");
    }

    // Everything from here — template, agreement, Schedule A, both signers, the
    // audit event — is shared with the partner API in lib/agreements/create.ts,
    // so a partner-originated agreement is byte-for-byte the same shape as one a
    // lender typed in. What stays here is the part that genuinely differs: how
    // the originator was resolved and which assets this caller may use.
    const requestId = text(body.request_id, 40);

    const { agreementId } = await createDraftAgreement(db, {
      originatorId,
      originatorKind: kind,
      assetIds: orderedIds,
      jurisdiction,
      activityClass,
      startsAt,
      endsAt,
      timeZone: timeZone ?? undefined,
      coverRequested: body.cover_requested !== false,
      lender: { userId, name: lenderName, email: lenderEmail },
      borrower: { name: borrowerName, email: borrowerEmail },
      context,
      auditExtra: {
        // Recorded because it changes what this draft is: not something the
        // lender composed, but their acceptance of an ask that came in off a
        // printed code.
        from_request_id: requestId ?? undefined,
      },
    });

    // A draft that began as a scanned request closes it here, and only here —
    // after the agreement, its schedule and its signers all exist. Anything that
    // failed above left the request pending, which is the recoverable state: the
    // lender sees it in the queue again rather than losing the borrower.
    if (requestId) {
      const { originatorIds } = await requireActor();
      await requestForActor(db, originatorIds, requestId);
      await markAccepted(db, requestId, agreementId);
    }

    return NextResponse.json({ id: agreementId }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
