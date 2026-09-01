import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui";
import { AppNav } from "@/components/AppNav";
import { Empty } from "@/components/app-ui";
import { ContactsManager, type Contact } from "@/components/ContactsManager";
import { userClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "People you lend to" };
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/contacts");

  const { data } = await supabase
    .from("contacts")
    .select("id, display_name, email, phone, notes, source, last_used_at")
    .is("archived_at", null)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("display_name");

  const contacts = (data ?? []) as Contact[];

  return (
    <Container className="py-14 sm:py-20">
      <AppNav />
      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
        People you lend to
      </h1>
      <p className="mt-4 max-w-prose text-ink-soft">
        Saved so you are not retyping a phone number every time. These details are
        copied onto an agreement when you create one — editing someone here never
        changes an agreement they have already signed.
      </p>

      {contacts.length === 0 && (
        <div className="mt-8">
          <Empty>
            Nobody saved yet. Add someone here, or let them be saved automatically
            the first time you send them an agreement.
          </Empty>
        </div>
      )}

      <ContactsManager initial={contacts} />
    </Container>
  );
}
