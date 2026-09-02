import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { completeStep } from "@/lib/partners/onboarding";
import {
  partnerApplicationNotice,
  partnerApplicationReceived,
  partnerApproved,
  partnerDeclined,
} from "@/lib/partners/emails";
import { partnerNotificationEmail } from "@/lib/env";
import { createCarrier } from "@/lib/coverage/admin";
import { createOnboardingLink } from "@/lib/coverage/onboarding";
import { carrierApproved } from "@/lib/coverage/emails";
import type { Staff } from "@/lib/platform/access";
import { logStaffAction } from "@/lib/platform/access";

/**
 * A partner application, from the form to the account.
 *
 * The interesting part is `approveApplication`, which is the only place a
 * `partners` row is created. Keeping it single means the invariants around a new
 * partner — a unique slug, an owner who can actually sign in, an onboarding
 * record that starts at step one — hold for every partner rather than for the
 * ones somebody remembered.
 *
 * Note what approval does NOT do: it issues no key. An approved partner has an
 * account and a way in, and the first key is minted in the console by the person
 * who will paste it into their configuration. That keeps the raw key out of an
 * email, and it means the audit trail says who took the credential rather than
 * who authorised it.
 */

/**
 * The vocabulary moved to lib/partners/vocabulary.ts when the console needed to
 * render these labels in the browser — this module is `server-only`, so a client
 * component importing it fails the build. Re-exported here so every existing
 * `from "@/lib/partners/applications"` keeps working and there is still one list.
 */
export {
  PARTNER_KINDS,
  PARTNER_KIND_LABELS,
  VOLUME_BANDS,
  VOLUME_BAND_LABELS,
  type PartnerKind,
} from "@/lib/partners/vocabulary";

import type { PartnerKind } from "@/lib/partners/vocabulary";

export class ApplicationRefused extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

/**
 * A URL-safe handle derived from the company name, made unique by counting.
 *
 * The slug appears in support conversations and eventually in a widget URL, so a
 * readable one is worth the extra query. Collisions are rare enough that a loop
 * beating against the unique index is cheaper than any scheme for avoiding it.
 */
async function uniqueSlug(db: SupabaseClient, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "partner";

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data } = await db
      .from("partners")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }

  // Fifty companies with the same name is not a real scenario; a timestamp is a
  // better outcome than a loop that never ends.
  return `${base}-${Date.now().toString(36)}`;
}

export type ApplicationInput = {
  companyName: string;
  website: string | null;
  partnerKind: PartnerKind;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  integrationInterest: "widget" | "api" | "redirect" | null;
  jurisdictions: string[];
  volumeBand: string | null;
  notes: string | null;
  source: string;
  userAgent: string | null;
};

export type SubmitResult = { status: "recorded" | "already_open" };

export async function submitApplication(
  db: SupabaseClient,
  input: ApplicationInput,
): Promise<SubmitResult> {
  const { data, error } = await db
    .from("partner_applications")
    .insert({
      company_name: input.companyName,
      website: input.website,
      partner_kind: input.partnerKind,
      contact_name: input.contactName,
      contact_email: input.contactEmail,
      contact_phone: input.contactPhone,
      integration_interest: input.integrationInterest,
      jurisdictions: input.jurisdictions,
      volume_band: input.volumeBand,
      notes: input.notes,
      source: input.source,
      user_agent: input.userAgent,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 is the partial unique index on an open application. Applying twice
    // while the first is still being read is not an error worth showing anyone,
    // and the same "we have it" answer is the truthful one.
    if (error.code === "23505") return { status: "already_open" };
    throw error;
  }

  await partnerApplicationReceived({
    to: input.contactEmail,
    contactName: input.contactName,
    companyName: input.companyName,
  });

  const notify = partnerNotificationEmail();
  if (notify) {
    await partnerApplicationNotice({
      to: notify,
      companyName: input.companyName,
      website: input.website,
      partnerKind: input.partnerKind,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      jurisdictions: input.jurisdictions,
      volumeBand: input.volumeBand,
      notes: input.notes,
      applicationId: data.id,
    });
  } else {
    // Loud, because an application nobody is told about is an application nobody
    // answers, and the failure is completely silent otherwise.
    console.warn(
      `partner application ${data.id} recorded but PARTNER_NOTIFICATIONS_EMAIL is not set — nobody was told.`,
    );
  }

  return { status: "recorded" };
}

export type ApprovalResult = {
  partnerId: string;
  slug: string;
};

/**
 * The application kinds that are NOT partners.
 *
 * A carrier or an MGA sits on the other side of the coverage boundary: we call
 * them, holding a credential they issued. `partners` / `partner_integrations`
 * model somebody who calls US and holds an inbound API key, so approving a
 * carrier into that table would hand them a key to an API they will never use
 * while their real credential had nowhere to live.
 *
 * They still apply through the same public form — an inbound lead is an inbound
 * lead — and approval routes them to `carriers` instead. See migration
 * 20260901000018.
 */
const CARRIER_APPLICATION_KINDS: readonly string[] = ["carrier", "mga"];

export function isCarrierApplication(kind: string): boolean {
  return CARRIER_APPLICATION_KINDS.includes(kind);
}

/**
 * Turn an application into a partner account. The only path that creates one.
 *
 * Refuses a carrier-kind application outright rather than quietly doing something
 * reasonable-looking with it: see `approveCarrierApplication`, which is where
 * those go.
 */
export async function approveApplication(
  staff: Staff,
  applicationId: string,
  options: { note?: string | null } = {},
): Promise<ApprovalResult> {
  const db = staff.db;

  const { data: application } = await db
    .from("partner_applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();

  if (!application) throw new ApplicationRefused("No such application.", 404);
  if (application.status === "approved") {
    throw new ApplicationRefused("That application has already been approved.", 409);
  }
  if (application.status === "withdrawn") {
    throw new ApplicationRefused("That application was withdrawn.", 409);
  }
  if (isCarrierApplication(application.partner_kind)) {
    throw new ApplicationRefused(
      "That is a carrier, not a distribution partner. Approve it as a carrier — it needs a carrier record and outbound credentials, not an inbound API key.",
      409,
    );
  }

  const slug = await uniqueSlug(db, application.company_name);

  const { data: partner, error: partnerError } = await db
    .from("partners")
    .insert({
      name: application.company_name,
      slug,
      kind: application.partner_kind,
      website: application.website,
      contact_email: application.contact_email,
      approved_at: new Date().toISOString(),
    })
    .select("id, slug")
    .single();

  if (partnerError || !partner) {
    throw new ApplicationRefused(
      `Could not create the partner: ${partnerError?.message}`,
      500,
    );
  }

  // The contact on the application becomes the owner. They may not have an
  // account yet — that is the point of the invitation being the address rather
  // than a token. lib/partners/access.ts binds it the first time they sign in.
  const { error: memberError } = await db.from("partner_members").insert({
    partner_id: partner.id,
    email: application.contact_email.toLowerCase(),
    role: "owner",
    invited_by: staff.userId,
  });

  if (memberError) {
    console.error(
      `partner ${partner.id} created but the owner invitation failed:`,
      memberError.message,
    );
  }

  await db
    .from("partner_applications")
    .update({
      status: "approved",
      status_note: options.note ?? null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: staff.userId,
      partner_id: partner.id,
    })
    .eq("id", applicationId);

  await completeStep(db, {
    partnerId: partner.id,
    step: "application_approved",
    completedBy: staff.userId,
    note: options.note ?? null,
  });

  await logStaffAction(staff, {
    action: "partner_application.approved",
    subjectType: "partner_application",
    subjectId: applicationId,
    detail: { partner_id: partner.id, slug, company: application.company_name },
  });

  await partnerApproved({
    to: application.contact_email,
    contactName: application.contact_name,
    companyName: application.company_name,
  });

  return { partnerId: partner.id, slug: partner.slug };
}

/**
 * Approve a carrier-kind application into a `carriers` row.
 *
 * Deliberately does much less than the partner path. No account is created and
 * no credential is issued, because neither is what happens next with a carrier:
 * what happens next is a contract, then filings, then somebody writes an adapter.
 * The row is a `prospect` until all three are true, and `setCarrierStatus`
 * refuses to make it active before there is code that can talk to it.
 *
 * It does now send an email, which it did not originally. "No account, therefore
 * no message" was a mistake of reasoning: it treated having somewhere to sign in
 * as the only reason to write to somebody. The effect was that a carrier applied,
 * we approved them, and they were never told — which from their side is
 * indistinguishable from being ignored. The message carries an onboarding link
 * instead of a login, because the link is what a carrier can actually use.
 */
export async function approveCarrierApplication(
  staff: Staff,
  applicationId: string,
  options: { note?: string | null } = {},
): Promise<{ carrierId: string; slug: string }> {
  const db = staff.db;

  const { data: application } = await db
    .from("partner_applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();

  if (!application) throw new ApplicationRefused("No such application.", 404);
  if (application.status === "approved") {
    throw new ApplicationRefused("That application has already been approved.", 409);
  }
  if (!isCarrierApplication(application.partner_kind)) {
    throw new ApplicationRefused(
      "That is a distribution partner, not a carrier. Approve it as a partner.",
      409,
    );
  }

  const carrier = await createCarrier(db, {
    name: application.company_name,
    kind: application.partner_kind === "mga" ? "mga" : "carrier",
    contactName: application.contact_name,
    contactEmail: application.contact_email,
    notes: options.note ?? application.notes,
    approvedAt: new Date(),
  });

  // `approved_as_carrier` is its own status rather than `approved`, for two
  // reasons that both matter. The constraint `approved_application_has_partner`
  // requires a partner_id on an approved row and there is no partner here; and
  // closing it as `declined` — the other tempting shortcut — would put the wrong
  // word in the queue for something we said yes to.
  //
  // No foreign key to `carriers` either. A column on partner_applications
  // pointing at a carrier would be the schema quietly asserting that a carrier is
  // a kind of partner, which is the exact confusion this whole split exists to
  // undo. The slug is in the note; the carrier is found by name.
  await db
    .from("partner_applications")
    .update({
      status: "approved_as_carrier",
      status_note: `Opened as carrier ${carrier.slug}.${
        options.note ? ` ${options.note}` : ""
      }`,
      reviewed_at: new Date().toISOString(),
      reviewed_by: staff.userId,
    })
    .eq("id", applicationId);

  await logStaffAction(staff, {
    action: "partner_application.approved_as_carrier",
    subjectType: "partner_application",
    subjectId: applicationId,
    detail: { carrier_id: carrier.id, slug: carrier.slug, company: application.company_name },
  });

  // Last, and outside anything that could undo the approval. Minting the link
  // touches the database, so a failure here is possible; an approval that rolled
  // back because an invitation could not be created would be the worst of the
  // available outcomes. Staff can re-send the link from the carrier page, and the
  // console shows when there has never been one.
  try {
    const { url, expiresAt } = await createOnboardingLink(db, {
      carrierId: carrier.id,
      sentTo: application.contact_email,
      createdBy: staff.userId,
    });

    await carrierApproved({
      to: application.contact_email,
      contactName: application.contact_name,
      companyName: application.company_name,
      onboardingUrl: url,
      expiresAt,
    });
  } catch (error) {
    console.error(
      `carrier ${carrier.id} approved but the onboarding invitation failed:`,
      (error as Error).message,
    );
  }

  return { carrierId: carrier.id, slug: carrier.slug };
}

export async function declineApplication(
  staff: Staff,
  applicationId: string,
  reason: string | null,
): Promise<void> {
  const db = staff.db;

  const { data: application } = await db
    .from("partner_applications")
    .select("id, status, contact_email, contact_name, company_name")
    .eq("id", applicationId)
    .maybeSingle();

  if (!application) throw new ApplicationRefused("No such application.", 404);
  if (application.status === "approved") {
    throw new ApplicationRefused(
      "That application was approved. Disable the partner instead of declining the application.",
      409,
    );
  }

  await db
    .from("partner_applications")
    .update({
      status: "declined",
      status_note: reason,
      reviewed_at: new Date().toISOString(),
      reviewed_by: staff.userId,
    })
    .eq("id", applicationId);

  await logStaffAction(staff, {
    action: "partner_application.declined",
    subjectType: "partner_application",
    subjectId: applicationId,
    detail: { reason },
  });

  await partnerDeclined({
    to: application.contact_email,
    contactName: application.contact_name,
    companyName: application.company_name,
    reason,
  });
}
