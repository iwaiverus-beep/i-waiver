import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui";
import { AppNav } from "@/components/AppNav";
import { Empty } from "@/components/app-ui";
import { AssetsManager, type Asset } from "@/components/AssetsManager";
import { userClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Things you lend" };
export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const supabase = await userClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/assets");

  const { data } = await supabase
    .from("assets")
    .select("id, asset_class, description, identifier, declared_value_cents, year, make, model")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const assets = (data ?? []) as Asset[];

  return (
    <Container className="py-14 sm:py-20">
      <AppNav />
      <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
        Things you lend
      </h1>
      <p className="mt-4 max-w-prose text-ink-soft">
        Save what you lend once and pick it from a list each time. Details are
        frozen onto an agreement when you send it, so changing a value here later
        never alters an agreement already signed.
      </p>

      {assets.length === 0 && (
        <div className="mt-8">
          <Empty>Nothing saved yet. Add the first thing you lend out.</Empty>
        </div>
      )}

      <AssetsManager initial={assets} />
    </Container>
  );
}
