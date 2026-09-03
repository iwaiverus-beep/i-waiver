import { AppHeader } from "@/components/AppHeader";
import { AppFooter } from "@/components/AppFooter";
import { EmulationBanner } from "@/components/EmulationBanner";
import { activeEmulation } from "@/lib/platform/emulation";

/**
 * Everything behind a sign-in: the lender area, the partner console, and admin.
 *
 * Splitting the chrome by route group rather than by "is there a session" is
 * what keeps the marketing pages static. Asking about the session in the root
 * layout would mean reading cookies on every page of the site, which opts all of
 * them out of static rendering to decide the contents of one navigation bar —
 * and it would still flash the wrong header first if the answer were resolved on
 * the client instead.
 *
 * The middleware already refuses these paths without a session, and each page
 * checks again, so by the time this renders the visitor is signed in and the
 * header can say so without asking.
 *
 * The row of tabs is not here. Three different sections live in this group and
 * each brings its own — `AppNav`, `AdminNav`, `PartnerNav` — so this layout is
 * only the shell around them.
 *
 * The emulation banner IS here, and this is the only place it could be. It has
 * to appear on every screen an operator could wander onto while viewing a
 * customer's account, and putting it in each of them would mean the one page
 * somebody forgot is the page where they mistake somebody else's data for their
 * own. Above the header deliberately: the state it reports is more important
 * than anything in the header, including who you are.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const emulation = await activeEmulation();

  return (
    <>
      {emulation && (
        <EmulationBanner
          label={emulation.targetLabel}
          expiresAt={emulation.expiresAt}
        />
      )}
      <AppHeader />
      <main className="flex-1">{children}</main>
      <AppFooter />
    </>
  );
}
