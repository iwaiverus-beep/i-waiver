import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container, PAGE_PADDING } from "@/components/ui";
import { AppNav } from "@/components/AppNav";
import { StatusBadge } from "@/components/app-ui";
import {
  SignatureReminder,
  type PendingSignature,
} from "@/components/SignatureReminder";
import { userClient } from "@/lib/supabase/server";
import { staffFor } from "@/lib/platform/access";
import {
  fetchAgreementPage,
  fetchAwaitingMySignature,
} from "@/lib/agreements/list";
import { DEFAULT_PARAMS, type AgreementListRow } from "@/lib/agreements/list-types";
import {
  ASSET_COLUMNS_WITH_PHOTOS,
  formatRate,
  orderedPhotos,
  photoUrl,
  type AssetPhoto,
  type RateUnit,
} from "@/lib/assets/fields";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/** How many of anything a section shows before it hands over to its own screen. */
const PREVIEW = 5;

type AssetRow = {
  id: string;
  description: string;
  year: number | null;
  make: string | null;
  model: string | null;
  rate_cents: number | null;
  rate_unit: RateUnit | null;
  asset_photos: AssetPhoto[] | null;
};

type ContactRow = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
};

/**
 * The screen signing in lands on.
 *
 * WHY A HUB AND NOT ONE OF THE LISTS. Three of the four lender screens are lists
 * and the fourth is a form, so whichever one was the front door made the other
 * three feel like somewhere else — and on a phone, opening on any single list
 * meant scrolling past thirty rows of one thing to find out whether there was
 * anything to do about another. This is the top of each of them, in the order a
 * loan actually happens: what you own, what you have lent, who you lend to, and
 * the button that starts the next one.
 *
 * Every section head is a link to the screen it is the top of. Five rows is not
 * a list, it is a sample — the moment somebody wants to search, sort or file,
 * they want the real screen, and the heading is where a reader already looks
 * when they want more of what is under it.
 *
 * The one thing that does not wait to be scrolled to is a signature the lender
 * owes; see `SignatureReminder`.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/home");

  // Staff land in the console, the same way they do from every other lender
  // entrance. `as=lender` is the way back for somebody who works here and also
  // lends their own things.
  const { as } = await searchParams;
  if (as !== "lender" && (await staffFor(user))) redirect("/admin");

  // Everything on this screen is a top-five, so it is five reads of five rows
  // rather than one read of everything. The agreements query is the dashboard's
  // own, at a shorter length: one list, one definition of "most recent".
  const [
    { data: assetRows, count: assetCount },
    { data: contactRows, count: contactCount },
    agreements,
    awaitingMe,
  ] = await Promise.all([
    // `count: "exact"` alongside the rows, so the heading can say "All 23" from
    // the same request that fetched five of them.
    supabase
      .from("assets")
      .select(ASSET_COLUMNS_WITH_PHOTOS, { count: "exact" })
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(PREVIEW),
    supabase
      .from("contacts")
      .select("id, display_name, email, phone", { count: "exact" })
      .is("archived_at", null)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("display_name")
      .limit(PREVIEW),
    fetchAgreementPage(
      supabase,
      // Recently active rather than newest: an agreement somebody signed this
      // morning matters more than one drafted last night and untouched since.
      { ...DEFAULT_PARAMS, sort: "activity" },
      PREVIEW,
    ),
    fetchAwaitingMySignature(supabase, user.email ?? null),
  ]);

  const assets = (assetRows ?? []) as unknown as AssetRow[];
  const contacts = (contactRows ?? []) as ContactRow[];

  const pending = awaitingMe.map(toPending);

  return (
    <Container className={PAGE_PADDING}>
      <AppNav />

      <SignatureReminder pending={pending} />

      <div className="space-y-12">
        <section>
          <SectionHead
            href="/assets"
            title="Things you lend"
            count={assetCount ?? assets.length}
          />

          {assets.length === 0 ? (
            <Blank href="/assets">
              Nothing saved yet. Add the first thing you lend out.
            </Blank>
          ) : (
            <ul className="mt-4 space-y-3">
              {assets.map((asset) => {
                const lead = orderedPhotos(asset.asset_photos)[0];
                const rate = formatRate(asset.rate_cents, asset.rate_unit);
                return (
                  <li
                    key={asset.id}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-5 py-4"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      {lead ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={photoUrl(lead.storage_path)}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-xl object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 shrink-0 rounded-xl border border-dashed border-line" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">
                          {assetTitle(asset)}
                        </p>
                        <p className="truncate text-sm text-ink-soft">
                          {asset.description}
                          {rate ? ` · ${rate}` : ""}
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/agreements/new?asset=${asset.id}`}
                      className="shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-paper transition-colors hover:bg-accent-hover"
                    >
                      Lend
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <SectionHead
            href="/dashboard?as=lender"
            title="Your agreements"
            count={agreements.total}
          />

          {agreements.rows.length === 0 ? (
            <Blank href="/agreements/new">
              Nothing lent out yet. The first agreement starts here.
            </Blank>
          ) : (
            <ul className="mt-4 space-y-3">
              {agreements.rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/agreements/${row.id}`}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-5 py-4 transition-colors hover:border-ink/25"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {row.borrower_name ?? "No borrower yet"}
                      </p>
                      <p className="truncate text-sm text-ink-soft">
                        {summarise(row)}
                      </p>
                    </div>
                    <span className="shrink-0">
                      <StatusBadge status={row.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionHead
            href="/contacts"
            title="People you lend to"
            count={contactCount ?? contacts.length}
          />

          {contacts.length === 0 ? (
            <Blank href="/contacts">
              Nobody saved yet. People are saved as you lend to them.
            </Blank>
          ) : (
            <ul className="mt-4 space-y-3">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {contact.display_name}
                    </p>
                    <p className="truncate text-sm text-ink-soft">
                      {[contact.email, contact.phone].filter(Boolean).join(" · ") ||
                        "—"}
                    </p>
                  </div>
                  <Link
                    href={`/agreements/new?contact=${contact.id}`}
                    className="shrink-0 rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
                  >
                    Lend again
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* The end of the scroll is the thing the whole screen is for. It is up
            in the corner menu as well, which is where somebody who already knows
            what they came for will reach for it — this is for the reader who has
            just been reminded what they own and who they lend it to. */}
        <section>
          <Link
            href="/agreements/new"
            className="flex items-center justify-between gap-4 rounded-2xl bg-accent px-6 py-5 text-paper transition-colors hover:bg-accent-hover"
          >
            <span>
              <span className="block font-serif text-xl tracking-tight">
                Lend something
              </span>
              <span className="mt-1 block text-sm text-paper/80">
                Pick the thing, name who is borrowing it, and send it to sign.
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-lg">
              →
            </span>
          </Link>
        </section>
      </div>
    </Container>
  );
}

/**
 * A section heading that is the way to its own screen.
 *
 * The whole line is the link, arrow included, because a heading with a separate
 * "see all" beside it is two targets for one idea — and on a phone the small one
 * is the one that gets missed.
 */
function SectionHead({
  href,
  title,
  count,
}: {
  href: string;
  title: string;
  count: number;
}) {
  return (
    <Link href={href} className="group flex items-baseline justify-between gap-3">
      <h2 className="font-serif text-2xl tracking-tight transition-colors group-hover:text-accent">
        {title}
      </h2>
      <span className="shrink-0 text-sm font-semibold text-ink-muted transition-colors group-hover:text-accent">
        {count > PREVIEW ? `All ${count}` : "Open"} →
      </span>
    </Link>
  );
}

/** What a section says when there is nothing in it yet. */
function Blank({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-4 block rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted transition-colors hover:border-ink/30 hover:text-ink"
    >
      {children}
    </Link>
  );
}

/** "2 items in FL · 3 Sep to 5 Sep" — the row's one line of detail. */
function summarise(row: AgreementListRow): string {
  const what =
    row.item_count > 1
      ? `${row.item_count} items`
      : row.activity_class.replace(/_/g, " ");
  return `${what} in ${row.jurisdiction} · ${formatDate(row.starts_at)} to ${formatDate(row.ends_at)}`;
}

/** "2021 Yamaha VX Cruiser", or the description when it has no year and make. */
function assetTitle(asset: AssetRow): string {
  return (
    [asset.year, asset.make, asset.model].filter(Boolean).join(" ") ||
    asset.description
  );
}

/**
 * One waiting agreement, in the words the dialog shows.
 *
 * Which agreements these are is decided by `fetchAwaitingMySignature`; this is
 * only how they read. "They have signed" is the sharpest thing the card can say
 * — it means the loan is waiting on nobody but the person holding the phone.
 */
function toPending(row: AgreementListRow): PendingSignature {
  return {
    id: row.id,
    borrowerName: row.borrower_name ?? "No borrower yet",
    summary:
      row.item_count > 1
        ? `${row.item_count} items in ${row.jurisdiction}`
        : `${row.activity_class.replace(/_/g, " ")} in ${row.jurisdiction}`,
    window: `${formatDate(row.starts_at)} to ${formatDate(row.ends_at)}`,
    othersSigned: (row.signers ?? []).some((signer) => signer.signed_at),
  };
}
