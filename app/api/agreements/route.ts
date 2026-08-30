import { NextResponse } from "next/server";
import { requestContext, recordAuditEvent } from "@/lib/audit";
import {
  ensureIndividualOriginator,
  requireActor,
} from "@/lib/agreements/access";
import { EMAIL_PATTERN, jsonError, readJson, text } from "@/lib/http";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { parseDollarsToCents } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  asset_id?: unknown;
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

    // --- The asset ---------------------------------------------------------
    let assetId = text(body.asset_id, 40);

    if (assetId) {
      const { data: owned } = await db
        .from("assets")
        .select("id")
        .eq("id", assetId)
        .eq("owner_user_id", userId)
        .maybeSingle();
      if (!owned) throw new TransitionRefused("That asset is not yours.");
    } else {
      const description = text(body.asset?.description, 200);
      if (!description) throw new TransitionRefused("Describe what is being lent.");

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
          owner_user_id: userId,
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
      assetId = asset.id;
    }

    // --- The template ------------------------------------------------------
    // A published version if one exists, otherwise the newest draft. Creating a
    // draft agreement against unreviewed wording is fine; sending it is not, and
    // the render guard is what stops that. Refusing here instead would hide the
    // real reason behind an empty screen.
    const { data: templateVersions } = await db
      .from("template_versions")
      .select("id, version, published_at, superseded_at")
      .eq("jurisdiction", jurisdiction)
      .eq("activity_class", activityClass)
      .is("superseded_at", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("version", { ascending: false });

    const templateVersion = templateVersions?.[0];
    if (!templateVersion) {
      throw new TransitionRefused(
        `There is no ${activityClass.replace(/_/g, " ")} template for ${jurisdiction} yet.`,
      );
    }

    // --- The agreement -----------------------------------------------------
    const { data: agreement, error: agreementError } = await db
      .from("agreements")
      .insert({
        originator_id: originatorId,
        asset_id: assetId,
        template_version_id: templateVersion.id,
        jurisdiction,
        activity_class: activityClass,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        status: "draft",
        cover_requested: body.cover_requested !== false,
      })
      .select("id")
      .single();

    if (agreementError || !agreement) {
      throw new TransitionRefused(`Could not create the agreement: ${agreementError?.message}`);
    }

    const { error: signerError } = await db.from("signers").insert([
      {
        agreement_id: agreement.id,
        role: "lender",
        capacity: "adult",
        user_id: userId,
        display_name: lenderName,
        email: lenderEmail,
        order_index: 0,
      },
      {
        agreement_id: agreement.id,
        role: "borrower",
        capacity: "adult",
        // Deliberately no user_id. A signer is not a user, and the borrower will
        // almost certainly never have an account.
        display_name: borrowerName,
        email: borrowerEmail,
        order_index: 1,
      },
    ]);

    if (signerError) {
      throw new TransitionRefused(`Could not add the signers: ${signerError.message}`);
    }

    await recordAuditEvent(db, {
      agreementId: agreement.id,
      type: "created",
      actor: "lender",
      payload: {
        jurisdiction,
        activity_class: activityClass,
        template_version_id: templateVersion.id,
        template_published: Boolean(templateVersion.published_at),
      },
      context,
    });

    return NextResponse.json({ id: agreement.id }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
