import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Container } from "./ui";

/**
 * The footer behind a sign-in: a rule, the small print, and nothing else.
 *
 * The marketing footer's four columns are a site map for somebody deciding
 * whether to sign up. Under a list of agreements they are dead weight — and
 * worse, "Get started" sitting under a dashboard belonging to somebody who
 * already did is an odd thing to be shown.
 *
 * The insurance paragraph stays. It is a compliance statement about what this
 * product is not offering, and the pages that talk about cover most plainly are
 * the ones in here, so this is the last place to drop it.
 */
export function AppFooter() {
  // No top margin. It carried 80px, which sat on top of the page's own bottom
  // padding and made the end of every short screen — the home screen most of all
  // — read as a hole rather than an ending. The page decides how far it finishes
  // above the rule; this only decides how the small print sits under it.
  return (
    <footer className="border-t border-line py-10">
      <Container>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <p className="text-xs text-ink-muted">
            © {new Date().getFullYear()} {BRAND.name}
          </p>
          <div className="flex items-center gap-6">
            <FooterLink href="/legal/privacy">Privacy</FooterLink>
            <FooterLink href="/legal/terms">Terms</FooterLink>
            <FooterLink href="/legal/messaging">Text messages</FooterLink>
          </div>
        </div>

        <p className="mt-5 max-w-3xl text-xs leading-relaxed text-ink-muted">
          Nothing here is an offer to sell, or a solicitation to buy, any
          insurance product. Availability of any coverage described depends on
          the issuing carrier, on state approval, and on eligibility, and it
          varies by state. A waiver is not enforceable in every state or in every
          circumstance.
        </p>
      </Container>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-xs text-ink-muted transition-colors hover:text-ink"
    >
      {children}
    </Link>
  );
}
