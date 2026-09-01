import Link from "next/link";
import { Container } from "@/components/ui";

/**
 * What a signed-in person sees at /partners/console when they are not a partner.
 *
 * Middleware only checks that somebody is signed in; whether they are a partner
 * member is a database question answered on the service client. So this state is
 * reachable by a lender who followed a link, and by somebody at an approved
 * partner who signed in with a different address from the one we were given —
 * which is by far the most likely reason anyone lands here, and the reason the
 * second paragraph says which address to check.
 */
export function NoPartnerAccess({ email }: { email: string | null }) {
  return (
    <Container className="py-20 sm:py-28">
      <div className="mx-auto max-w-xl">
        <h1 className="font-serif text-3xl tracking-tight">
          This account is not a partner
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          You are signed in{email ? ` as ${email}` : ""}, and that address is not
          on any partner account.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          Access is granted to a specific email address rather than through an
          invitation link, so if a colleague added you, sign in with the exact
          address they used — including whether it was your work address or a
          personal one.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/partners#apply"
            className="inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-accent-hover"
          >
            Apply to partner
          </Link>
          {/* POST, because /auth/signout refuses anything else — a sign-out a
              link prefetch can trigger is a bug. */}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex items-center rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
            >
              Sign in as someone else
            </button>
          </form>
        </div>
      </div>
    </Container>
  );
}
