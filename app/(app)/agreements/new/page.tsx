import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui";
import { Note } from "@/components/app-ui";
import {
  NewAgreementForm,
  type OpenState,
  type RequestPrefill,
} from "@/components/NewAgreementForm";
import type { Asset } from "@/components/AssetsManager";
import type { Contact } from "@/components/ContactsManager";
import { userClient } from "@/lib/supabase/server";
import { ASSET_COLUMNS_WITH_PHOTOS } from "@/lib/assets/fields";
import { requireActor } from "@/lib/agreements/access";
import { requestAddOns, requestForActor } from "@/lib/intake/requests";
import { readTimeZone } from "@/lib/profile";
import {
  READINESS_COLUMNS,
  statesOpenFor,
  type OriginatorKind,
  type ReadinessRow,
} from "@/lib/readiness";

export const metadata: Metadata = { title: "Lend something" };
export const dynamic = "force-dynamic";

export default async function NewAgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const supabase = await userClient();

  // `?request=` means a borrower scanned a code and this lender is looking at what
  // they asked for. Loaded through requestForActor, which refuses a request
  // belonging to somebody else — the id is in a URL a lender can edit.
  const { request: requestId } = await searchParams;
  let prefill: RequestPrefill | undefined;
  if (requestId) {
    const { db, originatorIds } = await requireActor();
    const asked = await requestForActor(db, originatorIds, requestId);
    if (asked.status === "pending") {
      const { data: link } = await db
        .from("intake_links")
        .select("jurisdiction")
        .eq("id", asked.intake_link_id)
        .maybeSingle();

      // The add-ons they ticked, after the thing itself. This is the whole of
      // what Schedule A gains from a merchandised page: the form opens with the
      // pontoon and the cooler picked instead of just the pontoon, and a person
      // still reads it and presses send. Nothing about origination, signing or
      // the compliance gate knows this happened.
      const addOns = await requestAddOns(db, asked.id);

      prefill = {
        requestId: asked.id,
        borrowerName: asked.borrower_name,
        borrowerEmail: asked.borrower_email ?? "",
        assetIds: [
          ...(asked.asset_id ? [asked.asset_id] : []),
          ...addOns.map((item) => item.id),
        ],
        startsAt: asked.starts_at,
        endsAt: asked.ends_at,
        jurisdiction: link?.jurisdiction ?? null,
        note: asked.note,
      };
    }
  }

  // Which combinations this lender can actually get a document out of.
  //
  // This used to read `state_availability` alone and offer every state that was
  // not `unavailable`, which answered half the question: a state is open when the
  // carrier is filed there, but a DOCUMENT also needs a rule set and wording
  // published for the activity AND for this lender's kind. Those came apart in
  // practice — Florida is admitted and has no business wording at all — so an
  // organisation was shown a form that refused every combination on it.
  //
  // `state_activity_readiness` (20260901000040) answers all of it in one read,
  // and `statesOpenFor` narrows it to this lender.
  const { data } = await supabase
    .from("state_activity_readiness")
    .select(READINESS_COLUMNS)
    .order("state");

  const readiness = (data ?? []) as ReadinessRow[];

  // 'individual', as a statement of fact rather than a default. POST /api/agreements
  // calls `ensureIndividualOriginator` unconditionally, so every draft made on this
  // screen is a private loan whoever is signed in — the business path does not exist
  // yet, and there is no organisation wording published for it to use if it did.
  // When that path is built this becomes the lender's real kind and nothing else
  // here changes.
  const kind: OriginatorKind = "individual";

  const states: OpenState[] = statesOpenFor(readiness, kind).map((s) => ({
    state: s.state,
    status: s.status,
    waiver_efficacy: s.waiverEfficacy,
  }));

  // The saved lists. Read under RLS, so each is already scoped to the caller.
  const [{ data: assetRows }, { data: contactRows }] = await Promise.all([
    supabase
      .from("assets")
      .select(ASSET_COLUMNS_WITH_PHOTOS)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("contacts")
      .select("id, display_name, email, phone, notes, source, last_used_at")
      .is("archived_at", null)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("display_name"),
  ]);

  // The lender's own clock, so the form can say how far a Florida window sits
  // from it. Presentation only — it never touches what the document says.
  const readerZone = await readTimeZone();

  const assets = (assetRows ?? []) as Asset[];
  const contacts = (contactRows ?? []) as Contact[];

  return (
    <Container className="py-14 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <Link href="/dashboard" className="text-sm text-ink-muted hover:text-ink">
          ← Back
        </Link>
        <h1 className="mt-4 font-serif text-3xl tracking-tight">Lend something</h1>

        {states.length === 0 ? (
          <div className="mt-8">
            <Note tone="warn">
              We are not open anywhere yet. Three separate things have to line up
              before a state can be offered: the carrier admitted and filed there,
              a rule set for the activity, and wording counsel has published. None
              of the three is a switch we can flip.
            </Note>
          </div>
        ) : (
          <div className="mt-10">
            <NewAgreementForm
              states={states}
              readiness={readiness}
              originatorKind={kind}
              assets={assets}
              contacts={contacts}
              prefill={prefill}
              readerZone={readerZone}
            />
          </div>
        )}
      </div>
    </Container>
  );
}
