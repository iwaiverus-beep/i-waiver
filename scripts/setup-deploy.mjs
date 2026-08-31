#!/usr/bin/env node
/**
 * One-shot deployment setup: Vercel project, env vars, domains, Cloudflare DNS.
 *
 * Idempotent. Run it twice and the second run reports "already correct" rather
 * than creating a duplicate of anything.
 *
 * ---------------------------------------------------------------------------
 * THE ISOLATION RULE
 *
 * This machine has a LeadLynk `CLOUDFLARE_API_TOKEN` in the ambient environment,
 * and — for now — the i-waiver.com zone lives in that same LeadLynk account (see
 * "Deployment accounts" in CLAUDE.md). So the rule is not about which account a
 * token is issued from; it is about how far that token can reach. Nothing here
 * reads the conventional variable names. Credentials come from iWaiver/.env.local
 * under iWaiver-specific names, and the preflight refuses to continue if they
 * resolve to LeadLynk's Vercel team or to any Cloudflare zone other than
 * i-waiver.com.
 *
 * That is a guard, not a convention. If someone pastes the wrong token in, this
 * script stops rather than reconfiguring the wrong company's DNS.
 * ---------------------------------------------------------------------------
 *
 *   node scripts/setup-deploy.mjs             # dry run: says what it would do
 *   node scripts/setup-deploy.mjs --apply     # actually does it
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

const DOMAIN = "i-waiver.com";
const PROJECT = "iwaiver";

// Refuse to act against these, whatever the token says it can do.
const FORBIDDEN_TEAM_SLUGS = ["leadlynk-projects"];
const FORBIDDEN_TEAM_IDS = ["team_PEmHhjLMfHxfp4XS3z22x0U9"];

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
};

const steps = [];
function did(what) {
  steps.push(`${c.green("done")}  ${what}`);
  console.log(`  ${c.green("✓")} ${what}`);
}
function would(what) {
  steps.push(`${c.amber("plan")}  ${what}`);
  console.log(`  ${c.amber("→")} would ${what}`);
}
function same(what) {
  console.log(`  ${c.dim("·")} ${c.dim(`${what} — already correct`)}`);
}
function die(message, hint) {
  console.error(`\n${c.red("STOPPED")} ${message}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

/** Reads .env.local without polluting process.env, so ambient tokens stay unused. */
function readEnvFile() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) {
    die(
      "No .env.local found.",
      "Create iWaiver/.env.local and add the two deployment tokens.\n" +
        "See the header of this script for which names to use.",
    );
  }
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function api(url, { token, method = "GET", body, label }) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const detail = json?.error?.message || json?.errors?.[0]?.message || text.slice(0, 300);
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
  return json;
}

const vercel = (path, token, teamId, options = {}) =>
  api(
    `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${teamId}`,
    { token, label: `Vercel ${path}`, ...options },
  );

const cf = (path, token, options = {}) =>
  api(`https://api.cloudflare.com/client/v4${path}`, {
    token,
    label: `Cloudflare ${path}`,
    ...options,
  });

// ---------------------------------------------------------------------------
// Preflight — prove we are pointed at the right accounts before touching either
// ---------------------------------------------------------------------------

async function preflight(env) {
  const vercelToken = env.IWAIVER_VERCEL_TOKEN;
  const cfToken = env.IWAIVER_CLOUDFLARE_API_TOKEN;

  if (!vercelToken) die("IWAIVER_VERCEL_TOKEN is not set in .env.local.");
  if (!cfToken) die("IWAIVER_CLOUDFLARE_API_TOKEN is not set in .env.local.");

  if (cfToken === process.env.CLOUDFLARE_API_TOKEN) {
    die(
      "IWAIVER_CLOUDFLARE_API_TOKEN is the same value as the ambient CLOUDFLARE_API_TOKEN.",
      "That ambient token is account-wide: it can edit every LeadLynk zone.\n" +
        "Create a separate token scoped to Zone:DNS:Edit on the i-waiver.com zone\n" +
        "only, and put that one in IWAIVER_CLOUDFLARE_API_TOKEN.",
    );
  }

  console.log(c.bold("\nPreflight"));

  // --- Vercel: which account is this, and is it the wrong one? --------------
  const teams = await api("https://api.vercel.com/v2/teams", {
    token: vercelToken,
    label: "Vercel teams",
  });

  const candidates = (teams.teams ?? []).filter(
    (t) => !FORBIDDEN_TEAM_SLUGS.includes(t.slug) && !FORBIDDEN_TEAM_IDS.includes(t.id),
  );

  const blocked = (teams.teams ?? []).filter(
    (t) => FORBIDDEN_TEAM_SLUGS.includes(t.slug) || FORBIDDEN_TEAM_IDS.includes(t.id),
  );

  if (candidates.length === 0) {
    die(
      blocked.length > 0
        ? `This Vercel token only reaches ${blocked.map((t) => t.slug).join(", ")}, which is off limits.`
        : "This Vercel token reaches no teams.",
      "Create the token from the i-waiver Vercel account:\n" +
        "  Vercel → Account Settings → Tokens → Create\n" +
        "  Scope it to the i-waiver team, not LeadLynk.",
    );
  }

  if (candidates.length > 1) {
    die(
      `This Vercel token reaches ${candidates.length} teams: ${candidates.map((t) => t.slug).join(", ")}.`,
      "Scope the token to one team so there is no ambiguity about where this deploys.",
    );
  }

  const team = candidates[0];
  console.log(`  ${c.green("✓")} Vercel team: ${c.bold(team.slug)} (${team.id})`);
  if (blocked.length > 0) {
    console.log(`  ${c.dim(`· ignoring off-limits team: ${blocked.map((t) => t.slug).join(", ")}`)}`);
  }

  // --- Cloudflare: is this token confined to i-waiver.com? -----------------
  await cf("/user/tokens/verify", cfToken);

  const zones = await cf(`/zones?name=${DOMAIN}`, cfToken);
  const zone = zones.result?.[0];

  if (!zone) {
    die(
      `This Cloudflare token cannot see the zone ${DOMAIN}.`,
      `Create the token from whichever Cloudflare account holds the ${DOMAIN} zone\n` +
        "(currently LeadLynk — see \"Deployment accounts\" in CLAUDE.md):\n" +
        "  Cloudflare → My Profile → API Tokens → Create Token\n" +
        `  Permissions: Zone → DNS → Edit,  Zone Resources: Include → Specific zone → ${DOMAIN}`,
    );
  }

  const allZones = await cf("/zones?per_page=50", cfToken);
  const reachable = (allZones.result ?? []).map((z) => z.name);
  const strays = reachable.filter((n) => n !== DOMAIN);

  if (strays.length > 0) {
    die(
      `This Cloudflare token can also edit: ${strays.join(", ")}.`,
      `Scope it to ${DOMAIN} only. A token that can reach a second zone is exactly\n` +
        "the accident this script exists to prevent.",
    );
  }

  console.log(`  ${c.green("✓")} Cloudflare zone: ${c.bold(zone.name)} (${zone.id})`);
  console.log(`  ${c.green("✓")} token is confined to that one zone`);

  return { vercelToken, cfToken, team, zone, env };
}

// ---------------------------------------------------------------------------
// Vercel: project, env vars, domains
// ---------------------------------------------------------------------------

/** Everything the running app needs. Values come from .env.local. */
const RUNTIME_VARS = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", required: true, secret: false },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, secret: false },
  { key: "SUPABASE_SERVICE_ROLE_KEY", required: true, secret: true },
  { key: "SIGNING_LINK_TOKEN_PEPPER", required: true, secret: true },
  { key: "RESEND_API_KEY", required: false, secret: true },
  { key: "EMAIL_FROM", required: false, secret: false },
  { key: "COVERAGE_INTERNAL_KEY", required: false, secret: true },
];

async function setupVercel({ vercelToken, team, env }) {
  console.log(c.bold("\nVercel"));
  const teamId = team.id;

  let project = null;
  try {
    project = await vercel(`/v9/projects/${PROJECT}`, vercelToken, teamId);
    same(`project ${PROJECT}`);
  } catch {
    if (APPLY) {
      project = await vercel("/v11/projects", vercelToken, teamId, {
        method: "POST",
        body: { name: PROJECT, framework: "nextjs" },
      });
      did(`create project ${PROJECT}`);
    } else {
      would(`create project ${PROJECT}`);
    }
  }

  // --- Environment variables ----------------------------------------------
  const existing = project
    ? await vercel(`/v10/projects/${PROJECT}/env`, vercelToken, teamId).catch(() => ({ envs: [] }))
    : { envs: [] };
  const have = new Set((existing.envs ?? []).map((e) => e.key));

  // The site's own origin. Without this, signing links point at localhost —
  // which is silent, and only discovered by a borrower who cannot sign.
  const wanted = [
    ...RUNTIME_VARS.map((v) => ({ ...v, value: env[v.key] })),
    {
      key: "NEXT_PUBLIC_SITE_URL",
      value: `https://www.${DOMAIN}`,
      required: true,
      secret: false,
    },
  ];

  for (const variable of wanted) {
    if (!variable.value) {
      if (variable.required) {
        die(
          `${variable.key} is required but missing from .env.local.`,
          variable.key === "SIGNING_LINK_TOKEN_PEPPER"
            ? 'Generate one:\n  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
            : undefined,
        );
      }
      console.log(`  ${c.dim(`· ${variable.key} not set locally — skipping`)}`);
      continue;
    }

    if (have.has(variable.key)) {
      same(variable.key);
      continue;
    }

    if (APPLY) {
      await vercel(`/v10/projects/${PROJECT}/env`, vercelToken, teamId, {
        method: "POST",
        body: {
          key: variable.key,
          value: variable.value,
          type: variable.secret ? "sensitive" : "encrypted",
          target: ["production", "preview", "development"],
        },
      });
      did(`set ${variable.key}${variable.secret ? c.dim(" (sensitive)") : ""}`);
    } else {
      would(`set ${variable.key}`);
    }
  }

  // --- Domains -------------------------------------------------------------
  const hosts = [DOMAIN, `www.${DOMAIN}`];
  const attached = project
    ? await vercel(`/v9/projects/${PROJECT}/domains`, vercelToken, teamId).catch(() => ({ domains: [] }))
    : { domains: [] };
  const attachedNames = new Set((attached.domains ?? []).map((d) => d.name));

  for (const host of hosts) {
    if (attachedNames.has(host)) {
      same(`domain ${host}`);
      continue;
    }
    if (APPLY) {
      await vercel(`/v10/projects/${PROJECT}/domains`, vercelToken, teamId, {
        method: "POST",
        body: { name: host },
      });
      did(`attach domain ${host}`);
    } else {
      would(`attach domain ${host}`);
    }
  }

  return { teamId };
}

// ---------------------------------------------------------------------------
// Cloudflare: DNS
// ---------------------------------------------------------------------------

/**
 * Asks Vercel what records it wants rather than hardcoding an IP. Vercel has
 * changed its published apex address before, and a stale constant here would
 * produce a domain that resolves to someone else's edge.
 */
async function desiredRecords(vercelToken, teamId) {
  const out = [];

  for (const host of [DOMAIN, `www.${DOMAIN}`]) {
    const config = await vercel(`/v6/domains/${host}/config`, vercelToken, teamId).catch(
      () => null,
    );

    const isApex = host === DOMAIN;
    const cname = config?.recommendedCNAME?.[0]?.value ?? config?.recommendedCNAME;
    const ipv4 = config?.recommendedIPv4?.[0]?.value?.[0] ?? config?.recommendedIPv4?.[0];

    if (isApex) {
      out.push({
        host,
        type: "A",
        content: typeof ipv4 === "string" ? ipv4 : "216.198.79.1",
        guessed: typeof ipv4 !== "string",
      });
    } else {
      out.push({
        host,
        type: "CNAME",
        content: typeof cname === "string" ? cname : "cname.vercel-dns.com",
        guessed: typeof cname !== "string",
      });
    }
  }

  return out;
}

async function setupDns({ cfToken, zone, vercelToken, teamId }) {
  console.log(c.bold("\nCloudflare DNS"));

  const records = await desiredRecords(vercelToken, teamId);
  const current = await cf(`/zones/${zone.id}/dns_records?per_page=100`, cfToken);

  for (const record of records) {
    if (record.guessed) {
      console.log(
        `  ${c.amber("!")} ${c.amber(`Vercel did not report a target for ${record.host}; using the documented default ${record.content}. Verify in the Vercel dashboard.`)}`,
      );
    }

    const found = (current.result ?? []).find(
      (r) => r.name === record.host && (r.type === "A" || r.type === "CNAME"),
    );

    // DNS-only, never proxied. CLAUDE.md calls this out: behind Cloudflare's
    // proxy, Vercel does not see the real request and certificate issuance and
    // the deployment's own routing both misbehave.
    const correct =
      found &&
      found.type === record.type &&
      found.content === record.content &&
      found.proxied === false;

    if (correct) {
      same(`${record.type} ${record.host} → ${record.content}`);
      continue;
    }

    if (!APPLY) {
      would(
        found
          ? `update ${record.host}: ${found.type} ${found.content}${found.proxied ? " (proxied)" : ""} → ${record.type} ${record.content} (DNS-only)`
          : `create ${record.type} ${record.host} → ${record.content} (DNS-only)`,
      );
      continue;
    }

    const body = {
      type: record.type,
      name: record.host,
      content: record.content,
      ttl: 1,
      proxied: false,
    };

    if (found) {
      await cf(`/zones/${zone.id}/dns_records/${found.id}`, cfToken, {
        method: "PATCH",
        body,
      });
      did(`update ${record.type} ${record.host} → ${record.content} (DNS-only)`);
    } else {
      await cf(`/zones/${zone.id}/dns_records`, cfToken, { method: "POST", body });
      did(`create ${record.type} ${record.host} → ${record.content} (DNS-only)`);
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(
    c.bold(`\niWaiver deployment setup ${APPLY ? c.red("— APPLYING") : c.dim("— dry run")}`),
  );
  if (!APPLY) {
    console.log(c.dim("Nothing will be changed. Re-run with --apply to act.\n"));
  }

  const env = readEnvFile();
  const ctx = await preflight(env);
  const { teamId } = await setupVercel(ctx);
  await setupDns({ ...ctx, teamId });

  console.log(c.bold("\nNext"));
  if (!APPLY) {
    console.log("  Re-run with --apply once the plan above looks right.");
  } else {
    console.log("  1. Push the repo and connect it to the Vercel project (or `vercel deploy`).");
    console.log("  2. Apply the Supabase migrations — this script does not touch the database.");
    console.log(`  3. DNS may take a few minutes; then https://www.${DOMAIN} should answer.`);
  }
  console.log();
}

main().catch((error) => {
  console.error(`\n${c.red("FAILED")} ${error.message}\n`);
  process.exit(1);
});
