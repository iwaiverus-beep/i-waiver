import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Container } from "./ui";

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface py-16">
      <Container>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-serif text-lg tracking-tight">{BRAND.name}</p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-soft">
              {BRAND.tagline}
            </p>
          </div>

          <FooterCol
            heading="Product"
            links={[
              { href: "/how-it-works", label: "How it works" },
              { href: "/individuals", label: "For individuals" },
              { href: "/businesses", label: "For businesses" },
            ]}
          />
          <FooterCol
            heading="Company"
            links={[
              { href: "/about", label: "About" },
              { href: "/#waitlist", label: "Request early access" },
            ]}
          />
          <FooterCol
            heading="Legal"
            links={[
              { href: "/legal/privacy", label: "Privacy" },
              { href: "/legal/terms", label: "Terms" },
            ]}
          />
        </div>

        <div className="mt-14 border-t border-line pt-8">
          <p className="max-w-3xl text-xs leading-relaxed text-ink-muted">
            {BRAND.name} is in development and is not yet accepting customers.
            Nothing on this site is an offer to sell, or a solicitation to buy,
            any insurance product. Availability of any coverage described here
            depends on the issuing carrier, on state approval, and on
            eligibility, and it varies by state. A waiver is not enforceable in
            every state or in every circumstance.
          </p>
          <p className="mt-6 text-xs text-ink-muted">
            © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
          </p>
        </div>
      </Container>
    </footer>
  );
}

function FooterCol({
  heading,
  links,
}: {
  heading: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink">
        {heading}
      </p>
      <ul className="mt-4 space-y-3">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link
              href={l.href}
              className="text-sm text-ink-soft transition-colors hover:text-ink"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
