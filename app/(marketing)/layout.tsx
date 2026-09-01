import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

/**
 * The public site: the marketing pages, the legal pages, sign-in, and the
 * token-carrying borrower flows (`/sign`, `/start`, `/join`).
 *
 * The borrower flows live here on purpose. Somebody signing a release has no
 * account and usually no idea what this is, so the masthead and the footer are
 * the only context they get about who is asking them to sign.
 *
 * These routes are a route group, so the parentheses do not appear in any URL —
 * `app/(marketing)/about/page.tsx` is still `/about`.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
