import { AppHeader } from "@/components/AppHeader";
import { AppFooter } from "@/components/AppFooter";

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
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main className="flex-1">{children}</main>
      <AppFooter />
    </>
  );
}
