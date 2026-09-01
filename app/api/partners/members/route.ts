import { NextResponse } from "next/server";
import { EMAIL_PATTERN, jsonError, readJson, text } from "@/lib/http";
import {
  membershipFor,
  requirePartnerActor,
  resolvePartnerId,
} from "@/lib/partners/access";
import { partnerMemberInvited } from "@/lib/partners/emails";
import { completeStep } from "@/lib/partners/onboarding";
import { PARTNER_ROLE_LABELS, type PartnerRole } from "@/lib/partners/roles";

export const runtime = "nodejs";

const ROLES: PartnerRole[] = ["owner", "admin", "developer", "viewer"];

/**
 * POST /api/partners/members — invite a colleague.
 *
 * The address is the invitation. A row goes in with an email and no user_id, and
 * lib/partners/access.ts binds it the first time that person signs in with a
 * confirmed account. Nothing is emailed that grants access, so a forwarded
 * invitation grants nothing to whoever it was forwarded to.
 */
export async function POST(request: Request) {
  try {
    const actor = await requirePartnerActor();
    const body = await readJson<Record<string, unknown>>(request);
    const partnerId = resolvePartnerId(actor, text(body.partner_id, 40));
    const membership = membershipFor(actor, partnerId, "members.manage");

    const email = text(body.email, 320)?.toLowerCase() ?? null;
    if (!email || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { error: "That does not look like an email address." },
        { status: 400 },
      );
    }

    const roleValue = text(body.role, 20) ?? "developer";
    const role: PartnerRole = ROLES.includes(roleValue as PartnerRole)
      ? (roleValue as PartnerRole)
      : "developer";

    // An admin may not make somebody an owner. Ownership is the role that can
    // remove everyone else, so it is granted by an owner or by our staff.
    if (role === "owner" && membership.role !== "owner") {
      return NextResponse.json(
        { error: "Only an owner can add another owner." },
        { status: 403 },
      );
    }

    const { error } = await actor.db.from("partner_members").insert({
      partner_id: partnerId,
      email,
      role,
      invited_by: actor.userId,
    });

    if (error) {
      // The unique index on (partner_id, lower(email)). Inviting somebody twice
      // is a mis-click, and the state they wanted is already true.
      if (error.code === "23505") {
        return NextResponse.json({ ok: true, already: true });
      }
      throw error;
    }

    await completeStep(actor.db, {
      partnerId,
      step: "team_invited",
      completedBy: actor.userId,
    });

    await partnerMemberInvited({
      to: email,
      companyName: membership.partnerName,
      invitedBy: actor.email,
      role: PARTNER_ROLE_LABELS[role].toLowerCase(),
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
