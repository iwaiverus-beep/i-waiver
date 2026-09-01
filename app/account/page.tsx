import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui";
import { AppNav } from "@/components/AppNav";
import { PasskeyManager } from "@/components/PasskeyManager";
import { userClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/account");

  return (
    <Container className="py-14 sm:py-20">
      <AppNav />
      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Your account</h1>
      <p className="mt-3 text-sm text-ink-soft">{user.email}</p>

      <section className="mt-12">
        <h2 className="font-serif text-2xl tracking-tight">
          Sign in with Face ID or a fingerprint
        </h2>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
          Adding a passkey lets this device sign you in with whatever unlocks it —
          Face ID, a fingerprint, or its PIN. The biometric never leaves the
          device: it unlocks a key held there, and we only ever see the signature
          it produces. There is nothing here for us to store or lose.
        </p>
        <div className="mt-6">
          <PasskeyManager />
        </div>
      </section>
    </Container>
  );
}
