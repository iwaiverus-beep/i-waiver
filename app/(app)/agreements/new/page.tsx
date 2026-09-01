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

  // Only states we are actually open in are offered. Availability is readable by
  // anon and authenticated — it is the one piece of reference data the public site
  // needs too.
  const { data } = await supabase
    .from("state_availability")
    .select("state, status, waiver_efficacy")
    .neq("status", "unavailable")
    .order("state");

  const states = (data ?? []) as OpenState[];

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
              We are not open anywhere yet. A state becomes available when the carrier
              is admitted and filed there — that is a fact about their licence, not a
              switch we can flip.
            </Note>
          </div>
        ) : (
          <div className="mt-10">
            <NewAgreementForm
              states={states}
              assets={assets}
              contacts={contacts}
              prefill={prefill}
            />
          </div>
        )}
      </div>
    </Container>
  );
}
