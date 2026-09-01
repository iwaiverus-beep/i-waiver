import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import {
  NotPartner,
  membershipFor,
  requirePartnerActor,
} from "@/lib/partners/access";

export const runtime = "nodejs";

/**
 * DELETE /api/partners/members/[id] — remove somebody's access.
 *
 * Revoked, not deleted, for the same reason keys are: who had access to a
 * partner's integration and when is a question that gets asked after something
 * has gone wrong, and it cannot be answered from rows that are gone.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const actor = await requirePartnerActor();

    const { data: member } = await actor.db
      .from("partner_members")
      .select("id, partner_id, role, user_id")
      .eq("id", id)
      .is("revoked_at", null)
      .maybeSingle();

    if (!member) throw new NotPartner();

    const membership = membershipFor(actor, member.partner_id, "members.manage");

    if (member.role === "owner" && membership.role !== "owner") {
      return NextResponse.json(
        { error: "Only an owner can remove an owner." },
        { status: 403 },
      );
    }

    // Nobody locks the company out of its own console. Removing the last owner is
    // refused here rather than being a support ticket tomorrow morning.
    if (member.role === "owner") {
      const { count } = await actor.db
        .from("partner_members")
        .select("id", { count: "exact", head: true })
        .eq("partner_id", member.partner_id)
        .eq("role", "owner")
        .is("revoked_at", null);

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          {
            error:
              "That is the only owner. Add another one first, or ask support to transfer the account.",
          },
          { status: 409 },
        );
      }
    }

    await actor.db
      .from("partner_members")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("partner_id", member.partner_id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
