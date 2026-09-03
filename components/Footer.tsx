import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { LIVE, PRIMARY_CTA } from "@/lib/launch";
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
              { href: "/partners", label: "For partners" },
            ]}
          />
          <FooterCol
            heading="Company"
            links={[
              { href: "/about", label: "About" },
              // The account menu is the other way in, and it is the way most
              // people will use — but it only exists behind a sign-in, and the
              // single likeliest reason to want a help page is not being able to
              // get behind one. So the public site links it too.
              { href: "/help", label: "Help" },
              { href: PRIMARY_CTA.href, label: PRIMARY_CTA.label },
            ]}
          />
          <FooterCol
            heading="Legal"
            links={[
              { href: "/legal/privacy", label: "Privacy" },
              { href: "/legal/terms", label: "Terms" },
              // Linked from the footer of every public page on purpose: a
              // messaging registration is reviewed by someone who looks for it
              // there before they look for it anywhere else.
              { href: "/legal/messaging", label: "Text messages" },
            ]}
          />
        </div>

        <div className="mt-14 border-t border-line pt-8">
          <p className="max-w-3xl text-xs leading-relaxed text-ink-muted">
            {/*
              Only the first clause moves with LIVE, and only because a site
              inviting people to get started while saying it is not accepting
              customers contradicts itself. Every sentence after it is a
              compliance statement about INSURANCE, which is a separate question
              from whether the agreements product is open — cover is still not
              being offered or solicited, so none of it is conditional.
            */}
            {!LIVE && `${BRAND.name} is in development and is not yet accepting customers. `}
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
