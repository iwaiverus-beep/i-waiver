import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui";
import { Note } from "@/components/app-ui";
import { NewAgreementForm, type OpenState } from "@/components/NewAgreementForm";
import { userClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lend something" };
export const dynamic = "force-dynamic";

export default async function NewAgreementPage() {
  const supabase = await userClient();

  // Only states we are actually open in are offered. Availability is readable by
  // anon and authenticated — it is the one piece of reference data the public site
  // needs too.
  const { data } = await supabase
    .from("state_availability")
    .select("state, status, waiver_efficacy")
    .neq("status", "unavailable")
    .order("state");

  const states = (data ?? []) as OpenState[];

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
            <NewAgreementForm states={states} />
          </div>
        )}
      </div>
    </Container>
  );
}
