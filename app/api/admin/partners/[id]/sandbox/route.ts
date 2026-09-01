import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { logStaffAction, NotStaff, requireStaff } from "@/lib/platform/access";

export const runtime = "nodejs";

/**
 * DELETE /api/admin/partners/[id]/sandbox — empty one partner's sandbox.
 *
 * The deletion itself is `public.purge_sandbox_coverage`, which filters every
 * statement on `environment = 'sandbox'` and takes no argument that widens it.
 * This route adds the two things a database function cannot: who asked, and a
 * confirmation that they meant this partner.
 *
 * Typing the partner's slug is not theatre. Support tools that delete things get
 * used with the wrong row selected, and a name typed by hand is the cheapest
 * defence there is against a mis-click on a list.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const staff = await requireStaff("sandbox.purge");
    const body = await readJson<Record<string, unknown>>(request);

    const { data: partner } = await staff.db
      .from("partners")
      .select("id, name, slug")
      .eq("id", id)
      .maybeSingle();

    if (!partner) throw new NotStaff("No such partner.");

    if (text(body.confirm_slug, 80) !== partner.slug) {
      return NextResponse.json(
        { error: `Type ${partner.slug} to confirm.` },
        { status: 400 },
      );
    }

    const { data, error } = await staff.db.rpc("purge_sandbox_coverage", {
      p_partner_id: id,
    });

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;

    await logStaffAction(staff, {
      action: "partner.sandbox.purged",
      subjectType: "partner",
      subjectId: id,
      detail: { slug: partner.slug, ...(result ?? {}) },
    });

    return NextResponse.json({ ok: true, deleted: result ?? null });
  } catch (error) {
    return jsonError(error);
  }
}
