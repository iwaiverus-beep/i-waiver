import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/tokens";
import { formatCents, formatInstant, timeZoneFor } from "@/lib/format";

/**
 * Assembling the document a signer sees.
 *
 * Two commitments shape everything here.
 *
 * Snapshot, don't reference (constraint 4). Once an agreement is sent, the asset
 * facts come from `agreements.asset_snapshot`, never from the live `assets` row.
 * If the owner edits the declared value in September, the June agreement must not
 * change underneath the signature on it.
 *
 * No unreviewed clause reaches a signer (constraint 5). Clause bodies are obtained
 * only from the `render_clause_set` RPC, which calls
 * `assert_clause_set_reviewed` before it returns a single character. There is no
 * code path in this file that reads `clause_versions` directly, and there must
 * never be one.
 */

export type AssetFacts = {
  asset_class: string;
  description: string;
  identifier: string | null;
  declared_value_cents: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
};

export type SignerFacts = {
  id: string;
  role: string;
  capacity: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  signed_at: string | null;
  declined_at: string | null;
};

export type RenderedClause = {
  ordinal: number;
  clause_version_id: string;
  kind: string;
  label: string;
  body: string;
  body_hash: string;
  requires_separate_signature: boolean;
  conspicuous: { uppercase?: boolean; bold?: boolean; min_font_pt?: number };
};

export type AgreementFacts = {
  id: string;
  jurisdiction: string;
  time_zone: string | null;
  activity_class: string;
  starts_at: string;
  ends_at: string;
  status: string;
  cover_requested: boolean;
  executed_at: string | null;
  template_version_id: string;
  asset_snapshot: AssetFacts | null;
  asset_snapshots: AssetFacts[] | null;
  asset_id: string | null;
};

export type AssembledDocument = {
  agreement: AgreementFacts;
  signers: SignerFacts[];
  /** Every item on the agreement, in schedule order. Never empty. */
  assets: AssetFacts[];
  /**
   * The lead item — `assets[0]`.
   *
   * Kept because a great deal of this application legitimately wants one thing
   * to name, and because removing it would have rewritten call sites that are
   * correct as they stand. Read `assets` wherever the answer should cover the
   * whole bundle, and `totalDeclaredValueCents` wherever money is involved.
   */
  asset: AssetFacts;
  /** Sum across the bundle. Equals the lead item's value when there is one item. */
  totalDeclaredValueCents: number | null;
  clauses: RenderedClause[];
  mergeValues: Record<string, string>;
  templateLabel: string;
  templateBodyHash: string;
  /** sha256 of `canonicalText`. This is what a signature is bound to. */
  documentHash: string;
  canonicalText: string;
  /** Everything needed to rebuild `canonicalText` byte for byte. */
  renderInputs: Record<string, unknown>;
  /** True while the state's clause set has not been through counsel. */
  specimen: boolean;
  waiverEfficacy: "standard" | "limited" | "void";
  availability: "live" | "cover_only" | "unavailable";
};

export class RenderError extends Error {}

/**
 * Substitutes {{merge_fields}}.
 *
 * An unknown field is an exception, not a blank. A document that reaches a signer
 * reading "you release {{lender_name}}" is not a document, and silently dropping
 * the field would produce one that reads worse and looks deliberate.
 */
function merge(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, field: string) => {
    const value = values[field];
    if (value === undefined) {
      throw new RenderError(
        `clause body refers to unknown merge field {{${field}}}`,
      );
    }
    return value;
  });
}

function assetFromSnapshot(raw: unknown): AssetFacts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as AssetFacts;
}

function assetsFromSnapshots(raw: unknown): AssetFacts[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items = raw.filter(
    (entry): entry is AssetFacts =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
  return items.length > 0 ? items : null;
}

function describeAsset(asset: AssetFacts): string {
  const bits = [asset.year?.toString(), asset.make, asset.model]
    .filter(Boolean)
    .join(" ");
  return bits ? `${bits} — ${asset.description}` : asset.description;
}

/**
 * What `{{asset_description}}` becomes.
 *
 * A single item keeps reading exactly as it always has — the clause wording that
 * counsel will review says "the {{asset_description}}", and for one jet ski that
 * has to remain a jet ski, not "the 1 item listed below".
 *
 * A bundle points at the schedule instead of trying to inline three descriptions
 * into the middle of a sentence. A release that reads "you assume all risk of
 * using the 2021 Yamaha VX Cruiser — Yamaha WaveRunner and the 2019 Load Rite
 * trailer — trailer and the kayak, red, 10ft" is one nobody finishes reading,
 * and unreadable is a real defence against enforcement.
 */
function describeBundle(assets: AssetFacts[]): string {
  if (assets.length === 1) return describeAsset(assets[0]);
  return `${assets.length} items listed in Schedule A below`;
}

/**
 * The bundle's total declared value.
 *
 * Null only if nothing in the bundle has a value at all, which is a draft that
 * `sendAgreement` refuses. A partially valued bundle sums what it knows rather
 * than collapsing to null: showing a lender "—" because one of four items is
 * blank tells them less than showing the figure and the gap.
 */
function totalDeclaredCents(assets: AssetFacts[]): number | null {
  const known = assets
    .map((asset) => asset.declared_value_cents)
    .filter((cents): cents is number => typeof cents === "number");
  if (known.length === 0) return null;
  return known.reduce((sum, cents) => sum + cents, 0);
}

/** One line per item, as it appears in Schedule A and in the canonical text. */
function scheduleLines(assets: AssetFacts[]): string[] {
  return assets.flatMap((asset, index) => [
    `${index + 1}. ${describeAsset(asset)}`,
    `   class: ${asset.asset_class}`,
    `   identifier: ${asset.identifier ?? ""}`,
    `   declared_value_cents: ${asset.declared_value_cents ?? ""}`,
  ]);
}

/**
 * Loads everything the document is made of and assembles it.
 *
 * `db` must be the service client: `render_clause_set` is revoked from
 * `authenticated`, because obtaining clause bodies is a server act.
 */
export async function assembleAgreement(
  db: SupabaseClient,
  agreementId: string,
): Promise<AssembledDocument> {
  const { data: agreement, error: agreementError } = await db
    .from("agreements")
    .select(
      "id, jurisdiction, time_zone, activity_class, starts_at, ends_at, status, cover_requested, executed_at, template_version_id, asset_snapshot, asset_snapshots, asset_id",
    )
    .eq("id", agreementId)
    .single();

  if (agreementError || !agreement) {
    throw new RenderError(`agreement ${agreementId} not found`);
  }

  const { data: signers, error: signersError } = await db
    .from("signers")
    .select(
      "id, role, capacity, display_name, email, phone, signed_at, declined_at, order_index",
    )
    .eq("agreement_id", agreementId)
    .order("order_index")
    .order("role");

  if (signersError) throw new RenderError(signersError.message);

  const lender = signers?.find((s) => s.role === "lender");
  const borrower = signers?.find((s) => s.role === "borrower");
  if (!lender || !borrower) {
    throw new RenderError(
      "an agreement needs both a lender and a borrower before it can be rendered",
    );
  }

  // Snapshots first, live rows only while still a draft. Once sent, the frozen
  // copy is the only truth about what was lent.
  //
  // Three sources in strict order of authority, and the order is the whole point:
  //
  //   1. `asset_snapshots` — a bundle frozen at send;
  //   2. `asset_snapshot`  — an agreement sent before bundles existed, which is
  //      a bundle of one and must keep rendering exactly as it did then;
  //   3. the live `agreement_assets` rows — a draft, which is allowed to move
  //      because nobody has signed anything yet.
  let assets =
    assetsFromSnapshots(agreement.asset_snapshots) ??
    (assetFromSnapshot(agreement.asset_snapshot)
      ? [assetFromSnapshot(agreement.asset_snapshot) as AssetFacts]
      : null);

  if (!assets) {
    const { data: live } = await db
      .from("agreement_assets")
      .select(
        "order_index, assets(asset_class, description, identifier, declared_value_cents, year, make, model)",
      )
      .eq("agreement_id", agreementId)
      .order("order_index");

    const rows = (live ?? [])
      .map((row) => {
        // PostgREST returns an embedded to-one as an object, but types it as a
        // union with an array. Normalised rather than cast blindly.
        const embedded = row.assets as unknown as AssetFacts | AssetFacts[] | null;
        return Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
      })
      .filter((entry): entry is AssetFacts => entry !== null);

    if (rows.length > 0) assets = rows;
  }

  // Last resort: an agreement whose lead asset never made it into the join
  // table. Should not happen after the backfill, and is cheap insurance against
  // a render that fails for a reason nobody can see from the outside.
  if (!assets && agreement.asset_id) {
    const { data: lead } = await db
      .from("assets")
      .select(
        "asset_class, description, identifier, declared_value_cents, year, make, model",
      )
      .eq("id", agreement.asset_id)
      .single();
    if (lead) assets = [lead as AssetFacts];
  }

  if (!assets || assets.length === 0) {
    throw new RenderError("agreement has no asset to describe");
  }

  const asset = assets[0];
  const bundled = assets.length > 1;
  const totalDeclaredValueCents = totalDeclaredCents(assets);

  const { data: availability } = await db
    .from("state_availability")
    .select("status, waiver_efficacy, clause_set_reviewed_at")
    .eq("state", agreement.jurisdiction)
    .maybeSingle();

  const { data: templateVersion, error: templateError } = await db
    .from("template_versions")
    .select("id, version, body_hash, jurisdiction, activity_class, templates(slug, name)")
    .eq("id", agreement.template_version_id)
    .single();

  if (templateError || !templateVersion) {
    throw new RenderError("template version not found");
  }

  // The only door to clause text. Raises if anything in the set is unpublished.
  const { data: clauseRows, error: clauseError } = await db.rpc(
    "render_clause_set",
    { p_template_version_id: agreement.template_version_id },
  );

  if (clauseError) {
    throw new RenderError(
      `refusing to render: ${clauseError.message}`,
    );
  }

  // The clock this window was written in. Stored on the agreement since
  // 20260901000020; the fallback is for rows written before that column and
  // reproduces exactly what those rows rendered as, so no existing document
  // changes. No new merge key is introduced — see the note below on hashes.
  const windowZone = agreement.time_zone ?? timeZoneFor(agreement.jurisdiction);

  // A single-item agreement produces EXACTLY the set of merge values it produced
  // before bundles existed — same keys, same strings. The canonical text lists
  // every merge value, so adding a key unconditionally would change the hash of
  // documents that are already signed. `item_count` is therefore added only on
  // the branch that could not have existed before.
  const mergeValues: Record<string, string> = {
    lender_name: lender.display_name,
    borrower_name: borrower.display_name,
    asset_description: describeBundle(assets),
    asset_identifier: bundled
      ? "listed in Schedule A"
      : (asset.identifier ?? "not recorded"),
    declared_value: formatCents(
      bundled ? totalDeclaredValueCents : asset.declared_value_cents,
    ),
    // The agreement's own zone, falling back to the state's only for rows
    // written before the column existed. Deriving it here is what made a
    // Washington loan print Eastern.
    starts_at: formatInstant(agreement.starts_at, windowZone),
    ends_at: formatInstant(agreement.ends_at, windowZone),
    jurisdiction: agreement.jurisdiction,
    activity_class: agreement.activity_class.replace(/_/g, " "),
  };

  if (bundled) {
    // For clause wording that wants to say "the three items" in words. Kept to a
    // single line: a multi-line merge value would spill across the line-oriented
    // canonical format and make the hashed text ambiguous to read back.
    mergeValues.item_count = String(assets.length);
  }

  const clauses: RenderedClause[] = (clauseRows ?? []).map((row: any) => ({
    ordinal: row.ordinal,
    clause_version_id: row.clause_version_id,
    kind: row.kind,
    label: row.label,
    body: merge(row.body_md, mergeValues),
    body_hash: row.body_hash,
    requires_separate_signature: row.requires_separate_signature,
    conspicuous: row.conspicuous_formatting ?? {},
  }));

  if (clauses.length === 0) {
    throw new RenderError("template version resolved to no clauses");
  }

  const templates = templateVersion.templates as unknown as
    | { slug: string; name: string }
    | { slug: string; name: string }[]
    | null;
  const template = Array.isArray(templates) ? templates[0] : templates;
  const templateLabel = `${template?.name ?? "Agreement"} (${template?.slug ?? "?"} v${templateVersion.version})`;

  const specimen = !availability?.clause_set_reviewed_at;

  const canonicalText = canonicalise({
    agreement: agreement as AgreementFacts,
    lender,
    borrower,
    assets,
    clauses,
    templateLabel,
    templateBodyHash: templateVersion.body_hash,
    mergeValues,
  });

  return {
    agreement: agreement as AgreementFacts,
    signers: (signers ?? []) as SignerFacts[],
    assets,
    asset,
    totalDeclaredValueCents,
    clauses,
    mergeValues,
    templateLabel,
    templateBodyHash: templateVersion.body_hash,
    documentHash: sha256Hex(canonicalText),
    canonicalText,
    renderInputs: {
      // v2 only where the document could not have been produced by v1. A
      // single-item agreement records the same inputs it always did, so a
      // document stored before bundles and one stored after are comparable.
      format: bundled ? "iwaiver-agreement-v2" : "iwaiver-agreement-v1",
      agreement_id: agreement.id,
      template_version_id: agreement.template_version_id,
      template_body_hash: templateVersion.body_hash,
      template_label: templateLabel,
      jurisdiction: agreement.jurisdiction,
      activity_class: agreement.activity_class,
      starts_at: agreement.starts_at,
      ends_at: agreement.ends_at,
      asset,
      ...(bundled
        ? { assets, total_declared_value_cents: totalDeclaredValueCents }
        : {}),
      merge_values: mergeValues,
      clause_versions: clauses.map((c) => ({
        ordinal: c.ordinal,
        clause_version_id: c.clause_version_id,
        body_hash: c.body_hash,
      })),
      parties: [lender, borrower].map((s) => ({
        signer_id: s.id,
        role: s.role,
        display_name: s.display_name,
      })),
      specimen,
    },
    specimen,
    waiverEfficacy: (availability?.waiver_efficacy ?? "standard") as
      | "standard"
      | "limited"
      | "void",
    availability: (availability?.status ?? "unavailable") as
      | "live"
      | "cover_only"
      | "unavailable",
  };
}

/**
 * The canonical serialisation — the exact bytes a signature is bound to.
 *
 * Deliberately plain text rather than JSON: when this hash is produced in a
 * dispute, someone has to be able to look at what was hashed and read it. The
 * ordering is fixed and nothing here depends on locale or map iteration order.
 *
 * TWO FORMATS, AND THE OLDER ONE IS FROZEN.
 *
 * V1 is what every agreement signed before bundles existed was hashed as. One
 * item still produces V1, byte for byte, down to the singular `ASSET` header.
 * Not for tidiness — because `documents.sha256` and every `signatures.
 * document_hash_at_signing` in the database were computed from these exact
 * bytes, and a "harmless" reformat would turn every signed agreement into one
 * that fails its own verification. The V1 branch below is effectively immutable.
 *
 * V2 replaces the ASSET block with SCHEDULE A and is used only where there is
 * more than one item — a document V1 could never have produced, so nothing
 * already hashed can be affected by anything done to it.
 */
function canonicalise(input: {
  agreement: AgreementFacts;
  lender: SignerFacts;
  borrower: SignerFacts;
  assets: AssetFacts[];
  clauses: RenderedClause[];
  templateLabel: string;
  templateBodyHash: string;
  mergeValues: Record<string, string>;
}): string {
  const bundled = input.assets.length > 1;
  const asset = input.assets[0];

  const lines: string[] = [
    bundled ? "IWAIVER-AGREEMENT-V2" : "IWAIVER-AGREEMENT-V1",
    `agreement_id: ${input.agreement.id}`,
    `template: ${input.templateLabel}`,
    `template_version_id: ${input.agreement.template_version_id}`,
    `template_body_hash: ${input.templateBodyHash}`,
    `jurisdiction: ${input.agreement.jurisdiction}`,
    `activity_class: ${input.agreement.activity_class}`,
    `starts_at: ${input.agreement.starts_at}`,
    `ends_at: ${input.agreement.ends_at}`,
    "",
    "PARTIES",
    `lender: ${input.lender.display_name} <${input.lender.email ?? input.lender.phone ?? ""}> [${input.lender.id}]`,
    `borrower: ${input.borrower.display_name} <${input.borrower.email ?? input.borrower.phone ?? ""}> [${input.borrower.id}]`,
    "",
    ...(bundled
      ? [
          "SCHEDULE A - ITEMS LENT",
          `item_count: ${input.assets.length}`,
          `total_declared_value_cents: ${totalDeclaredCents(input.assets) ?? ""}`,
          "",
          ...scheduleLines(input.assets),
        ]
      : [
          "ASSET",
          `class: ${asset.asset_class}`,
          `description: ${asset.description}`,
          `identifier: ${asset.identifier ?? ""}`,
          `declared_value_cents: ${asset.declared_value_cents ?? ""}`,
          `year: ${asset.year ?? ""}`,
          `make: ${asset.make ?? ""}`,
          `model: ${asset.model ?? ""}`,
        ]),
    "",
    "MERGE VALUES",
    ...Object.keys(input.mergeValues)
      .sort()
      .map((key) => `${key}: ${input.mergeValues[key]}`),
    "",
    "CLAUSES",
  ];

  for (const clause of input.clauses) {
    lines.push(
      "",
      `--- ${clause.ordinal}. ${clause.label}`,
      `kind: ${clause.kind}`,
      `clause_version_id: ${clause.clause_version_id}`,
      `body_hash: ${clause.body_hash}`,
      "",
      clause.body,
    );
  }

  lines.push("", "END");
  // \n throughout, no trailing whitespace: the hash must not depend on the
  // platform that produced it.
  return lines.map((line) => line.replace(/\s+$/, "")).join("\n");
}
