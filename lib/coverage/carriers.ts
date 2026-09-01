import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { carrierClient, UnknownCarrierAdapter } from "@/lib/coverage/carrier";
import type { CarrierClient } from "@/lib/coverage/carrier";
import type { CoverageKind } from "@/lib/coverage/contract";
import type { ApiEnvironment } from "@/lib/coverage/service";

/**
 * Choosing who writes the risk.
 *
 * Before 20260901000018 this question did not exist: `state_availability.
 * carrier_admitted` was a boolean, there was one anonymous carrier, and
 * `carrierClient()` returned a singleton. Now a state can have several products
 * filed by several carriers, and something has to decide.
 *
 * THE RULE IS PER PRODUCT, NOT PER CARRIER, and that is the important design
 * choice here. A programme where physical damage sits with one carrier and
 * liability with another is completely ordinary, so picking a single "best"
 * carrier for the whole quote would either drop cover the customer could have had
 * or require a routing policy nobody has written yet. Instead every product is
 * quoted by whoever filed it, each quote records its own `carrier_id`, and
 * binding follows the quote. Two policies from two carriers is a thing the domain
 * already models — `quotes` are per coverage kind, not per agreement.
 *
 * The consequence to keep in mind: one carrier's API being down degrades a quote
 * rather than failing it. `quoteAcrossCarriers` collects what it can and reports
 * what it could not, which is the right failure mode for a screen that has to
 * show a signer something.
 */

export type AvailableProduct = {
  carrierId: string;
  carrierSlug: string;
  carrierName: string;
  adapter: string;
  productCode: string;
  coverageKind: CoverageKind;
  admitted: boolean;
};

export class NoCarrierAvailable extends Error {
  constructor(readonly state: string, readonly activityClass: string) {
    super(`No filed product for ${activityClass} in ${state}.`);
  }
}

/**
 * What may be written, where, today.
 *
 * SANDBOX IS DELIBERATELY DIFFERENT and this is the only place it is. A sandbox
 * call resolves to the mock carrier in every state, ignoring filings entirely —
 * partly so a partner can build before their states open (the reason already
 * documented in lib/jurisdictions.ts), and mostly because a test must never reach
 * a real carrier's production API. When a real carrier offers a sandbox of their
 * own this becomes a per-carrier choice driven by `carrier_credentials.
 * environment`; until one does, pretending otherwise would be a lie with a
 * network call attached.
 */
export async function availableProducts(
  db: SupabaseClient,
  input: {
    state: string;
    activityClass: string;
    environment: ApiEnvironment;
    /** The date the filings must have been in force on. Defaults to today. */
    on?: string;
  },
): Promise<AvailableProduct[]> {
  if (input.environment === "sandbox") {
    const { data } = await db
      .from("carrier_products")
      .select("product_code, coverage_kind, carriers!inner(id, slug, name, adapter, status)")
      .eq("activity_class", input.activityClass)
      .is("retired_at", null)
      .eq("carriers.adapter", "mock")
      .eq("carriers.status", "active");

    return (data ?? []).flatMap((row) => {
      const carrier = (Array.isArray(row.carriers) ? row.carriers[0] : row.carriers) as
        | { id: string; slug: string; name: string; adapter: string }
        | null;
      if (!carrier) return [];
      return [
        {
          carrierId: carrier.id,
          carrierSlug: carrier.slug,
          carrierName: carrier.name,
          adapter: carrier.adapter,
          productCode: row.product_code as string,
          coverageKind: row.coverage_kind as CoverageKind,
          // Nothing in a sandbox is admitted anywhere. Saying `true` here would
          // put the word "admitted" on a test.
          admitted: false,
        },
      ];
    });
  }

  const { data, error } = await db.rpc("available_carrier_products", {
    p_state: input.state,
    p_activity_class: input.activityClass,
    ...(input.on ? { p_on: input.on } : {}),
  });

  if (error) throw new Error(`Could not read filings: ${error.message}`);

  return (data ?? []).map(
    (row: {
      carrier_id: string;
      carrier_slug: string;
      carrier_name: string;
      adapter: string;
      product_code: string;
      coverage_kind: CoverageKind;
      admitted: boolean;
    }) => ({
      carrierId: row.carrier_id,
      carrierSlug: row.carrier_slug,
      carrierName: row.carrier_name,
      adapter: row.adapter,
      productCode: row.product_code,
      coverageKind: row.coverage_kind,
      admitted: row.admitted,
    }),
  );
}

export type CarrierGroup = {
  carrierId: string;
  carrierName: string;
  adapter: string;
  client: CarrierClient;
  /** Only the codes this carrier may write here. */
  productCodes: Set<string>;
  kinds: CoverageKind[];
};

/**
 * Group what is available by carrier, resolving each one's adapter.
 *
 * A carrier whose adapter is not registered is DROPPED, loudly. It is not
 * silently served by the mock: a real carrier's row appearing in the database
 * before its client is written would otherwise produce `MOCK-` policy numbers
 * under that carrier's name, which is the worst possible failure here.
 */
export function groupByCarrier(
  products: AvailableProduct[],
  requestedKinds: CoverageKind[],
): CarrierGroup[] {
  const wanted = new Set(requestedKinds);
  const groups = new Map<string, CarrierGroup>();

  for (const product of products) {
    if (!wanted.has(product.coverageKind)) continue;

    let group = groups.get(product.carrierId);

    if (!group) {
      let client: CarrierClient;
      try {
        client = carrierClient(product.adapter);
      } catch (error) {
        if (error instanceof UnknownCarrierAdapter) {
          console.error(
            `carrier ${product.carrierName} (${product.carrierId}) has adapter "${product.adapter}" with no implementation — skipping it rather than quoting it as the mock.`,
          );
          continue;
        }
        throw error;
      }

      group = {
        carrierId: product.carrierId,
        carrierName: product.carrierName,
        adapter: product.adapter,
        client,
        productCodes: new Set(),
        kinds: [],
      };
      groups.set(product.carrierId, group);
    }

    group.productCodes.add(product.productCode);
    if (!group.kinds.includes(product.coverageKind)) {
      group.kinds.push(product.coverageKind);
    }
  }

  return [...groups.values()];
}
