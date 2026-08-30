import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/tokens";
import { formatCents, formatInstant } from "@/lib/format";

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
  activity_class: string;
  starts_at: string;
  ends_at: string;
  status: string;
  cover_requested: boolean;
  executed_at: string | null;
  template_version_id: string;
  asset_snapshot: AssetFacts | null;
  asset_id: string | null;
};

export type AssembledDocument = {
  agreement: AgreementFacts;
  signers: SignerFacts[];
  asset: AssetFacts;
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
  if (!raw || typeof raw !== "object") return null;
  return raw as AssetFacts;
}

function describeAsset(asset: AssetFacts): string {
  const bits = [asset.year?.toString(), asset.make, asset.model]
    .filter(Boolean)
    .join(" ");
  return bits ? `${bits} — ${asset.description}` : asset.description;
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
      "id, jurisdiction, activity_class, starts_at, ends_at, status, cover_requested, executed_at, template_version_id, asset_snapshot, asset_id",
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

  // Snapshot first, live row only while still a draft. Once sent, the snapshot is
  // the only truth about the asset.
  let asset = assetFromSnapshot(agreement.asset_snapshot);
  if (!asset && agreement.asset_id) {
    const { data: live } = await db
      .from("assets")
      .select(
        "asset_class, description, identifier, declared_value_cents, year, make, model",
      )
      .eq("id", agreement.asset_id)
      .single();
    asset = (live as AssetFacts | null) ?? null;
  }

  if (!asset) {
    throw new RenderError("agreement has no asset to describe");
  }

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

  const mergeValues: Record<string, string> = {
    lender_name: lender.display_name,
    borrower_name: borrower.display_name,
    asset_description: describeAsset(asset),
    asset_identifier: asset.identifier ?? "not recorded",
    declared_value: formatCents(asset.declared_value_cents),
    starts_at: formatInstant(agreement.starts_at, agreement.jurisdiction),
    ends_at: formatInstant(agreement.ends_at, agreement.jurisdiction),
    jurisdiction: agreement.jurisdiction,
    activity_class: agreement.activity_class.replace(/_/g, " "),
  };

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
    asset,
    clauses,
    templateLabel,
    templateBodyHash: templateVersion.body_hash,
    mergeValues,
  });

  return {
    agreement: agreement as AgreementFacts,
    signers: (signers ?? []) as SignerFacts[],
    asset,
    clauses,
    mergeValues,
    templateLabel,
    templateBodyHash: templateVersion.body_hash,
    documentHash: sha256Hex(canonicalText),
    canonicalText,
    renderInputs: {
      format: "iwaiver-agreement-v1",
      agreement_id: agreement.id,
      template_version_id: agreement.template_version_id,
      template_body_hash: templateVersion.body_hash,
      template_label: templateLabel,
      jurisdiction: agreement.jurisdiction,
      activity_class: agreement.activity_class,
      starts_at: agreement.starts_at,
      ends_at: agreement.ends_at,
      asset,
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
 */
function canonicalise(input: {
  agreement: AgreementFacts;
  lender: SignerFacts;
  borrower: SignerFacts;
  asset: AssetFacts;
  clauses: RenderedClause[];
  templateLabel: string;
  templateBodyHash: string;
  mergeValues: Record<string, string>;
}): string {
  const lines: string[] = [
    "IWAIVER-AGREEMENT-V1",
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
    "ASSET",
    `class: ${input.asset.asset_class}`,
    `description: ${input.asset.description}`,
    `identifier: ${input.asset.identifier ?? ""}`,
    `declared_value_cents: ${input.asset.declared_value_cents ?? ""}`,
    `year: ${input.asset.year ?? ""}`,
    `make: ${input.asset.make ?? ""}`,
    `model: ${input.asset.model ?? ""}`,
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
