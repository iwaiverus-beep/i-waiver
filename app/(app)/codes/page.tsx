import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui";
import { userClient } from "@/lib/supabase/server";
import { requireActor } from "@/lib/agreements/access";
import { CodesManager, type IntakeLinkRow } from "@/components/CodesManager";
import type { Asset } from "@/components/AssetsManager";
import type { OpenState } from "@/components/NewAgreementForm";

export const metadata: Metadata = { title: "Your codes" };
export const dynamic = "force-dynamic";

/**
 * The printable codes.
 *
 * A lender makes two kinds here. One for the business or the person — stick it on
 * the counter, anyone can start something. One per item — stick it on the trailer,
 * and whoever scans it is asking for that specific thing, which is what lets their
 * side of the form be complete without a stranger typing the declared value.
 */
export default async function CodesPage() {
  const { db, originatorIds } = await requireActor();
  const supabase = await userClient();

  const [{ data: assetRows }, { data: stateRows }] = await Promise.all([
    supabase
      .from("assets")
      .select("id, asset_class, description, identifier, declared_value_cents, year, make, model")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("state_availability")
      .select("state, status, waiver_efficacy")
      .neq("status", "unavailable")
      .order("state"),
  ]);

  const { data: linkRows } = originatorIds.length
    ? await db
        .from("intake_links")
        .select("id, asset_id, slug, label, activity_class, jurisdiction, created_at")
        .in("originator_id", originatorIds)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <Container className="py-14 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <Link href="/dashboard" className="text-sm text-ink-muted hover:text-ink">
          ← Back
        </Link>
        <h1 className="mt-4 font-serif text-3xl tracking-tight">Your codes</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Print one and someone can start their side of an agreement by pointing a
          camera at it. Nothing is agreed by scanning — the request lands in your
          queue, and you decide.
        </p>

        <CodesManager
          links={(linkRows ?? []) as IntakeLinkRow[]}
          assets={(assetRows ?? []) as Asset[]}
          states={(stateRows ?? []) as OpenState[]}
        />
      </div>
    </Container>
  );
}
