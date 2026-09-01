import type { SupabaseClient } from "@supabase/supabase-js";
import { NotAuthorised } from "@/lib/agreements/access";
import { TransitionRefused } from "@/lib/agreements/lifecycle";
import { resolveIntakeLink } from "@/lib/intake/links";

/**
 * The queue a scan feeds.
 *
 * A request is not an agreement and must never quietly become one. It records what
 * an unverified stranger typed into a public form, and it stays inert until a
 * lender looks at it and acts. Accepting one creates an ordinary draft by the
 * ordinary route; declining or ignoring one costs nothing, which is the property
 * that makes a permanently public QR code safe to print at all.
 */

export type AgreementRequest = {
  id: string;
  intake_link_id: string;
  originator_id: string;
  asset_id: string | null;
  borrower_name: string;
  borrower_email: string | null;
  borrower_phone: string | null;
  starts_at: string | null;
  ends_at: string | null;
  note: string | null;
  status: "pending" | "accepted" | "declined" | "expired";
  agreement_id: string | null;
  expires_at: string;
  created_at: string;
};

/**
 * How many requests one code may produce in an hour.
 *
 * A printed code is scannable by anybody who walks past it, so this is the only
 * thing standing between a bored passer-by and a queue nobody can read. Counted
 * per link rather than per IP: the abuse that matters is one code being hammered,
 * and a phone on mobile data changes address for free.
 */
const MAX_PER_LINK_PER_HOUR = 20;

/**
 * Files a borrower's ask. Runs unauthenticated, on the service client.
 *
 * Everything structural — which lender, which asset, which activity, which state —
 * is taken from the resolved link. The only things read from the submitted body are
 * the borrower's own details and the dates they want. That split is the point: a
 * stranger describes themselves, never the terms.
 */
export async function submitRequest(
  db: SupabaseClient,
  input: {
    slug: string;
    borrowerName: string;
    borrowerEmail: string | null;
    borrowerPhone: string | null;
    startsAt: string | null;
    endsAt: string | null;
    note: string | null;
    /** Add-ons the borrower ticked. Ids only, and checked against what was offered. */
    addOnIds: string[];
    ip: string | null;
    userAgent: string | null;
  },
): Promise<AgreementRequest> {
  const resolved = await resolveIntakeLink(db, input.slug);
  if (!resolved) throw new NotAuthorised("That code is not one of ours.");
  if (resolved.link.revoked_at) {
    throw new TransitionRefused("This code is no longer in use. Ask them for a current one.");
  }

  if (!input.borrowerEmail && !input.borrowerPhone) {
    throw new TransitionRefused("Leave an email address or a phone number so they can reach you.");
  }

  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
    throw new TransitionRefused("The end of the loan has to come after the start.");
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("agreement_requests")
    .select("id", { count: "exact", head: true })
    .eq("intake_link_id", resolved.link.id)
    .gte("created_at", since);

  if ((count ?? 0) >= MAX_PER_LINK_PER_HOUR) {
    // Deliberately vague. Naming the limit tells someone probing it exactly what
    // to wait out, and the honest reading for a real borrower is the same either
    // way: come back, or find a person.
    throw new TransitionRefused(
      "Too many requests have come from this code just now. Try again shortly, or ask them directly.",
    );
  }

  const { data, error } = await db
    .from("agreement_requests")
    .insert({
      intake_link_id: resolved.link.id,
      originator_id: resolved.link.originator_id,
      asset_id: resolved.link.asset_id,
      borrower_name: input.borrowerName,
      borrower_email: input.borrowerEmail,
      borrower_phone: input.borrowerPhone,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      note: input.note,
      submitted_ip: input.ip,
      submitted_agent: input.userAgent,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(`could not file the request: ${error?.message}`);

  // The add-ons, filtered against what this code actually offered.
  //
  // This is the same split the rest of the function turns on. A borrower says
  // WHICH of the suggestions they want; they do not get to name an item. An id
  // that was not on the page is dropped rather than refused — the honest reading
  // of an unexpected id is a stale page or a fiddled form, and in both cases the
  // request is still a real one from a real person standing at a counter.
  const offered = new Map(resolved.offers.map((offer, index) => [offer.id, index]));
  const chosen = input.addOnIds
    .filter((assetId) => offered.has(assetId))
    .sort((a, b) => (offered.get(a) ?? 0) - (offered.get(b) ?? 0));

  if (chosen.length > 0) {
    const { error: itemsError } = await db.from("agreement_request_items").insert(
      chosen.map((assetId, index) => ({
        request_id: data.id,
        asset_id: assetId,
        order_index: index,
      })),
    );

    // Not fatal. The request itself is the thing that must survive — a lender
    // with a name and a phone number can ask what else they wanted, and losing
    // the borrower over a cooler would be the worse trade.
    if (itemsError) {
      console.error(`request ${data.id}: could not record add-ons:`, itemsError.message);
    }
  }

  return data;
}

/**
 * The add-ons on a request, in the order they were shown.
 *
 * Read separately rather than embedded for the same reason `offersFor` is two
 * queries: `agreement_request_items` and `assets` join cleanly, but the lender's
 * queue wants the item's own facts and PostgREST would need naming which foreign
 * key to follow.
 */
export type RequestAddOn = {
  id: string;
  description: string;
  rate_cents: number | null;
  rate_unit: string | null;
};

export async function requestAddOns(
  db: SupabaseClient,
  requestId: string,
): Promise<RequestAddOn[]> {
  const byRequest = await addOnsForRequests(db, [requestId]);
  return byRequest.get(requestId) ?? [];
}

/**
 * The same thing for a whole queue, in two queries rather than two per row.
 *
 * The queue is the screen that matters: a lender with eight requests waiting
 * should not pay eight round trips to find out that two of them wanted a cooler.
 */
export async function addOnsForRequests(
  db: SupabaseClient,
  requestIds: string[],
): Promise<Map<string, RequestAddOn[]>> {
  const out = new Map<string, RequestAddOn[]>();
  if (requestIds.length === 0) return out;

  const { data: items } = await db
    .from("agreement_request_items")
    .select("request_id, asset_id, order_index")
    .in("request_id", requestIds)
    .order("order_index");

  if (!items || items.length === 0) return out;

  const { data: assets } = await db
    .from("assets")
    .select("id, description, rate_cents, rate_unit")
    .in("id", [...new Set(items.map((item) => item.asset_id))]);

  const byId = new Map((assets ?? []).map((asset) => [asset.id, asset as RequestAddOn]));

  for (const item of items) {
    const asset = byId.get(item.asset_id);
    if (!asset) continue;
    out.set(item.request_id, [...(out.get(item.request_id) ?? []), asset]);
  }

  return out;
}

/**
 * This lender's live queue, newest first.
 *
 * Ages out stale rows on the way past, so there is no scheduled job to forget and
 * no queue that quietly fills with strangers who came in a fortnight ago and have
 * long since gone home.
 */
export async function pendingRequests(
  db: SupabaseClient,
  originatorIds: string[],
): Promise<AgreementRequest[]> {
  if (originatorIds.length === 0) return [];

  await db.rpc("expire_stale_requests");

  const { data } = await db
    .from("agreement_requests")
    .select("*")
    .in("originator_id", originatorIds)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return data ?? [];
}

/** One request, only if it belongs to this lender. */
export async function requestForActor(
  db: SupabaseClient,
  originatorIds: string[],
  requestId: string,
): Promise<AgreementRequest> {
  if (originatorIds.length === 0) throw new NotAuthorised();

  const { data } = await db
    .from("agreement_requests")
    .select("*")
    .eq("id", requestId)
    .in("originator_id", originatorIds)
    .maybeSingle();

  if (!data) throw new NotAuthorised();
  return data;
}

/**
 * Marks a request declined.
 *
 * Terminal and quiet: the borrower is not told, because a public code that reports
 * back would let anyone test whether a given lender is paying attention, and
 * because "no" from a business is a conversation, not a notification.
 */
export async function declineRequest(
  db: SupabaseClient,
  originatorIds: string[],
  requestId: string,
): Promise<void> {
  const request = await requestForActor(db, originatorIds, requestId);
  if (request.status !== "pending") {
    throw new TransitionRefused("That request has already been dealt with.");
  }

  await db
    .from("agreement_requests")
    .update({ status: "declined", decided_at: new Date().toISOString() })
    .eq("id", requestId);
}

/**
 * Binds an accepted request to the draft it produced.
 *
 * Called after the draft exists, never before: `accepted_request_has_an_agreement`
 * refuses the status without the id, so a failed draft leaves the request pending
 * and the lender simply sees it again rather than losing the borrower entirely.
 */
export async function markAccepted(
  db: SupabaseClient,
  requestId: string,
  agreementId: string,
): Promise<void> {
  const { error } = await db
    .from("agreement_requests")
    .update({
      status: "accepted",
      agreement_id: agreementId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) throw new Error(`could not close the request: ${error.message}`);
}
