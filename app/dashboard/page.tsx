import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui";
import { AppNav } from "@/components/AppNav";
import { Empty, Note, StatusBadge } from "@/components/app-ui";
import { userClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Your agreements" };
export const dynamic = "force-dynamic";

type SignerRow = { role: string; display_name: string; signed_at: string | null };

export default async function DashboardPage() {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/dashboard");

  // Read as the signed-in user, not as the service role: the participation
  // policies decide what comes back, which is exactly the check we want here.
  const { data: agreements } = await supabase
    .from("agreements")
    .select(
      "id, status, jurisdiction, activity_class, starts_at, ends_at, created_at, executed_at, signers(role, display_name, signed_at)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = agreements ?? [];
  const drafts = rows.filter((a) => a.status === "draft").length;
  const awaiting = rows.filter((a) =>
    ["sent", "partially_signed"].includes(a.status),
  ).length;

  return (
    <Container className="py-14 sm:py-20">
      <AppNav />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Your agreements</h1>
          <p className="mt-2 text-sm text-ink-soft">
            {rows.length === 0
              ? "Nothing here yet."
              : `${rows.length} total · ${drafts} draft · ${awaiting} waiting on a signature`}
          </p>
        </div>
        <Link
          href="/agreements/new"
          className="inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
        >
          Lend something
        </Link>
      </div>

      <div className="mt-10 space-y-3">
        {rows.length === 0 && (
          <div className="rounded-2xl border border-line bg-paper px-6 py-12">
            <Empty>
              Start by describing what you are lending, to whom, and for how long.
            </Empty>
          </div>
        )}

        {rows.map((agreement) => {
          const signers = (agreement.signers ?? []) as SignerRow[];
          const borrower = signers.find((s) => s.role === "borrower");
          const outstanding = signers.filter((s) => !s.signed_at);

          return (
            <Link
              key={agreement.id}
              href={`/agreements/${agreement.id}`}
              className="block rounded-2xl border border-line bg-paper px-6 py-5 transition-colors hover:border-ink/25"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-ink">
                    {borrower?.display_name ?? "No borrower yet"}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {agreement.activity_class.replace(/_/g, " ")} in{" "}
                    {agreement.jurisdiction} ·{" "}
                    {formatDate(agreement.starts_at)} to {formatDate(agreement.ends_at)}
                  </p>
                  {outstanding.length > 0 && agreement.status !== "draft" && (
                    <p className="mt-1.5 text-xs text-ink-muted">
                      Waiting on{" "}
                      {outstanding.map((s) => s.display_name).join(" and ")}
                    </p>
                  )}
                </div>
                <StatusBadge status={agreement.status} />
              </div>
            </Link>
          );
        })}
      </div>

      {rows.some((a) => a.status === "draft") && (
        <div className="mt-8">
          <Note>
            A draft is not an agreement. Nothing is frozen, nobody has been asked to
            sign, and the asset details can still change underneath it.
          </Note>
        </div>
      )}
    </Container>
  );
}
