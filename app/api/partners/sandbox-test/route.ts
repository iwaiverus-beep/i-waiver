import { NextResponse } from "next/server";
import { jsonError, readJson, text } from "@/lib/http";
import { requirePartnerActor } from "@/lib/partners/access";
import { environmentOf } from "@/lib/partners/keys";
import { siteOrigin } from "@/lib/env";

export const runtime = "nodejs";

/**
 * POST /api/partners/sandbox-test — run a real quote (and optionally a bind)
 * against the partner's own sandbox key, and hand back both halves verbatim.
 *
 * WHY A PROXY AND NOT A CURL COMMAND IN THE DOCS. Both, actually — the docs have
 * the curl. This exists because the first thing that goes wrong in an integration
 * is never the business logic, it is the shape of the payload, and a partner who
 * can see a working request beside their own has a five-minute problem instead of
 * a support ticket. The response is returned unedited, status code included, so
 * what they read here is exactly what their own code will get.
 *
 * THE KEY. It arrives in the request body, is used once, and is not stored, not
 * logged and not attached to any error. It has to come from the partner rather
 * than from our database because we do not hold it — only its hash — which is the
 * property that makes the whole credential design worth anything. The one thing
 * checked before it is used is that it is a SANDBOX key: this endpoint exists to
 * let people experiment, and an experiment run with a live key by mistake would
 * bind real cover.
 */
export async function POST(request: Request) {
  try {
    // Being signed in is not what authorises the coverage call — the key does
    // that. It is required so that this cannot be used as an open relay for
    // guessing keys against our own API from someone else's IP address.
    await requirePartnerActor();

    const body = await readJson<Record<string, unknown>>(request);
    const key = text(body.api_key, 200);

    if (!key) {
      return NextResponse.json(
        { error: "Paste a sandbox key to test with." },
        { status: 400 },
      );
    }

    if (environmentOf(key) !== "sandbox") {
      return NextResponse.json(
        {
          error:
            "That is not a sandbox key. This tester binds cover, so it will only run against sandbox.",
        },
        { status: 400 },
      );
    }

    const jurisdiction = (text(body.jurisdiction, 2) ?? "FL").toUpperCase();
    const alsoBind = body.bind === true;

    const starts = new Date(Date.now() + 60 * 60 * 1000);
    const ends = new Date(starts.getTime() + 6 * 60 * 60 * 1000);

    // The sample payload is the smallest thing that gets a real answer, which is
    // the payload worth showing someone first.
    const quoteRequest = {
      context: {
        activity_class: text(body.activity_class, 60) ?? "personal_watercraft",
        jurisdiction,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        parties: [
          { external_ref: "test-lender-1", name: "Sandbox Lender", role: "lender" },
          {
            external_ref: "test-borrower-1",
            name: "Sandbox Borrower",
            role: "borrower",
            age_band: "25-34",
          },
        ],
        asset: {
          asset_class: "pwc",
          description: "2021 Sea-Doo GTI 130",
          declared_value_cents: 950_000,
        },
      },
      beneficiary_external_ref: "test-borrower-1",
    };

    const quote = await callCoverage("/quote", key, quoteRequest);

    if (!alsoBind || quote.status >= 400) {
      return NextResponse.json({
        quote: { request: quoteRequest, ...quote },
        bind: null,
      });
    }

    const options = (quote.body as { options?: { quote_id: string }[] }).options ?? [];
    if (options.length === 0) {
      return NextResponse.json({
        quote: { request: quoteRequest, ...quote },
        bind: null,
        note: "No options came back, so there was nothing to bind.",
      });
    }

    const bindRequest = { quote_ids: [options[0].quote_id] };
    const bind = await callCoverage("/bind", key, bindRequest);

    return NextResponse.json({
      quote: { request: quoteRequest, ...quote },
      bind: { request: bindRequest, ...bind },
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function callCoverage(
  path: string,
  key: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${siteOrigin()}/api/coverage/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  return {
    status: response.status,
    body: await response.json().catch(() => ({ error: "Response was not JSON." })),
  };
}
