import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Container, PAGE_PADDING } from "@/components/ui";
import { AppNav } from "@/components/AppNav";
import { PasskeyManager } from "@/components/PasskeyManager";
import { ProfileForm } from "@/components/ProfileForm";
import { EmailForm, PasswordForm } from "@/components/AccountCredentials";
import { PayoutHandles } from "@/components/PayoutHandles";
import { readProfile } from "@/lib/profile";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

/**
 * Everything about the person rather than about a thing they lent.
 *
 * One page with anchored sections rather than five screens, because these are all
 * things somebody does once while setting up and then rarely again — and the menu
 * in the header links straight at each `id`, so "change my password" is still one
 * click from anywhere in the product.
 *
 * The order is deliberate: who you are, then the two credentials, then the two
 * things that are optional and therefore easy to skip past.
 */
export default async function AccountPage() {
  const profile = await readProfile();
  if (!profile) redirect("/login?next=/account");

  return (
    <Container className={PAGE_PADDING}>
      <AppNav />

      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">Your account</h1>
      <p className="mt-3 text-sm text-ink-soft">{profile.email}</p>

      <div className="mt-12 space-y-16">
        <Section
          id="profile"
          title="Your profile"
          description="Your name is what appears on every agreement you send. The picture is only ever shown back to you."
        >
          <ProfileForm
            initial={{
              full_name: profile.full_name,
              phone: profile.phone,
              home_state: profile.home_state,
              time_zone: profile.time_zone,
              avatar_url: profile.avatar_url,
              email: profile.email,
            }}
          />
        </Section>

        <Section
          id="email"
          title="Email address"
          description="Changing this changes how you sign in, so it takes a confirmation link before it takes effect."
        >
          <EmailForm current={profile.email} />
        </Section>

        <Section id="password" title="Password">
          <PasswordForm />
        </Section>

        <Section
          id="passkeys"
          title="Sign in with Face ID or a fingerprint"
          description="Adding a passkey lets this device sign you in with whatever unlocks it. The biometric never leaves the device: it unlocks a key held there, and we only ever see the signature it produces. There is nothing here for us to store or lose."
        >
          <PasskeyManager />
        </Section>

        <Section
          id="paid"
          title="Getting paid"
          description="Where a borrower is told to send a fuel or launch-fee reimbursement. A handoff, not a payment we process."
        >
          <PayoutHandles />
        </Section>
      </div>
    </Container>
  );
}

/**
 * `scroll-mt` is not decoration. The header is sticky, so an anchored jump lands
 * with the heading underneath it unless the target reserves the height back.
 */
function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-32">
      <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
      {description && (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
          {description}
        </p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}
