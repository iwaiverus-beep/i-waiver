import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container, PAGE_PADDING } from "@/components/ui";
import { AppNav } from "@/components/AppNav";
import { Empty } from "@/components/app-ui";
import { PageIntro } from "@/components/PageIntro";
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
    <Container className={PAGE_PADDING}>
      <AppNav />
      {/* Open while the list is empty - see the note on the same line in
          app/(app)/assets/page.tsx. */}
      <PageIntro title="People you lend to" defaultOpen={contacts.length === 0}>
        Saved so you are not retyping a phone number every time. These details are
        copied onto an agreement when you create one — editing someone here never
        changes an agreement they have already signed.
      </PageIntro>

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
