import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { OAuthButtons } from "@/components/OAuthButtons";
import { PasskeySignIn } from "@/components/PasskeySignIn";
import { Container } from "@/components/ui";
import { configurationProblems } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const problems = configurationProblems();

  // Only relative paths, so a crafted ?next= cannot bounce someone off-site
  // carrying a fresh session.
  const destination =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  return (
    <Container className="py-20 sm:py-28">
      <div className="mx-auto max-w-md">
        <h1 className="font-serif text-3xl tracking-tight">Sign in</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          An account is for people who lend things out. If someone has sent you
          something to sign, use the link in your email — you do not need one of these.
        </p>

        {problems.length > 0 ? (
          <div className="mt-8 rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4">
            <p className="text-sm font-semibold text-flag">
              This deployment is not configured yet.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-flag">
              Missing: {problems.join(", ")}. Add them to{" "}
              <code className="font-mono text-xs">.env.local</code>.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            {error && (
              <p className="rounded-xl border border-flag/30 bg-flag/[0.06] px-5 py-4 text-sm text-flag">
                {error}
              </p>
            )}
            <PasskeySignIn next={destination} />
            <OAuthButtons next={destination} />
            <AuthForm next={destination} />
          </div>
        )}
      </div>
    </Container>
  );
}
