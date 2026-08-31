#!/usr/bin/env node
/**
 * Registers i-waiver.com with Resend and writes the DNS it asks for.
 *
 * Two keys, on purpose:
 *
 *   RESEND_API_KEY        sending only. This is what the deployed app holds, and
 *                         a sending-only key is the correct thing for it to hold:
 *                         a leaked one can send mail, not reconfigure the domain.
 *
 *   RESEND_ADMIN_API_KEY  full access, needed once to register the domain and
 *                         read back its DNS records. Delete it in the Resend
 *                         dashboard when this script has finished.
 *
 * ---------------------------------------------------------------------------
 * THE RECORD THAT MUST NOT BE TOUCHED
 *
 * i-waiver.com already receives mail through Cloudflare Email Routing, which owns
 * the apex MX records and the apex SPF TXT. A domain may have only ONE SPF
 * record, so writing a second would silently break either sending or receiving,
 * and the symptom would show up days later as mail landing in spam.
 *
 * Resend scopes its own SPF and MX to the `send.` subdomain, so in practice there
 * is no collision. This script does not take that on trust: it refuses to create
 * or modify anything at the apex, and stops rather than guessing.
 * ---------------------------------------------------------------------------
 *
 *   node scripts/setup-email.mjs           # dry run
 *   node scripts/setup-email.mjs --apply
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

const DOMAIN = "i-waiver.com";
const REGION = "us-east-1";
const PROJECT = "iwaiver";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
};

function die(message, hint) {
  console.error(`\n${c.red("STOPPED")} ${message}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}
const did = (s) => console.log(`  ${c.green("✓")} ${s}`);
const would = (s) => console.log(`  ${c.amber("→")} would ${s}`);
const same = (s) => console.log(`  ${c.dim(`· ${s} — already correct`)}`);

function readEnvFile() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) die("No .env.local found.");
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
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
    throw new Error(
      `${label} (${response.status}): ${json?.message || json?.error?.message || text.slice(0, 300)}`,
    );
  }
  return json;
}

const resend = (path, token, options = {}) =>
  api(`https://api.resend.com${path}`, { token, label: `Resend ${path}`, ...options });

const cf = (path, token, options = {}) =>
  api(`https://api.cloudflare.com/client/v4${path}`, {
    token,
    label: `Cloudflare ${path}`,
    ...options,
  });

/** Resend returns names relative to the domain; Cloudflare wants them absolute. */
function absolute(name) {
  if (!name || name === "@") return DOMAIN;
  return name.endsWith(DOMAIN) ? name : `${name}.${DOMAIN}`;
}

async function main() {
  console.log(
    c.bold(`\niWaiver email setup ${APPLY ? c.red("— APPLYING") : c.dim("— dry run")}`),
  );

  const env = readEnvFile();
  const adminKey = env.RESEND_ADMIN_API_KEY || null;
  const sendKey = env.RESEND_API_KEY || null;
  const cfToken = env.IWAIVER_CLOUDFLARE_API_TOKEN;
  const vercelToken = env.IWAIVER_VERCEL_TOKEN;

  if (!cfToken) die("IWAIVER_CLOUDFLARE_API_TOKEN is not set in .env.local.");
  if (!adminKey) {
    die(
      "RESEND_ADMIN_API_KEY is not set in .env.local.",
      "Resend → API Keys → Create API Key → permission FULL ACCESS.\n" +
        "Add it as RESEND_ADMIN_API_KEY (keep RESEND_API_KEY as the sending-only one),\n" +
        "run this script, then delete the admin key in the Resend dashboard.",
    );
  }

  console.log(c.bold("\nPreflight"));

  // --- Cloudflare, same isolation rule as everywhere else ------------------
  const zones = await cf(`/zones?name=${DOMAIN}`, cfToken);
  const zone = zones.result?.[0];
  if (!zone) die(`Cloudflare token cannot see the zone ${DOMAIN}.`);
  const allZones = await cf("/zones?per_page=50", cfToken);
  const strays = (allZones.result ?? []).map((z) => z.name).filter((n) => n !== DOMAIN);
  if (strays.length) die(`Cloudflare token can also reach: ${strays.join(", ")}.`);
  console.log(`  ${c.green("✓")} Cloudflare zone ${c.bold(DOMAIN)}, and only that zone`);

  // --- Resend admin key ----------------------------------------------------
  const existing = await resend("/domains", adminKey);
  const domains = existing.data ?? existing ?? [];
  console.log(`  ${c.green("✓")} Resend admin key works (${domains.length} domain(s) registered)`);

  // --- Register the domain -------------------------------------------------
  console.log(c.bold("\nResend"));
  let domain = domains.find((d) => d.name === DOMAIN);

  if (domain) {
    same(`domain ${DOMAIN} (status ${domain.status})`);
  } else if (!APPLY) {
    would(`register ${DOMAIN} with Resend (region ${REGION})`);
    console.log(
      `\n  ${c.dim("The DNS plan cannot be shown until the domain exists — Resend generates")}\n` +
        `  ${c.dim("the DKIM key at registration. Re-run with --apply to see and write it.")}\n`,
    );
    return;
  } else {
    domain = await resend("/domains", adminKey, {
      method: "POST",
      body: { name: DOMAIN, region: REGION },
    });
    did(`register ${DOMAIN} (region ${REGION})`);
  }

  const detail = await resend(`/domains/${domain.id}`, adminKey);
  const records = detail.records ?? domain.records ?? [];
  if (!records.length) die("Resend returned no DNS records to create.");

  // --- Write the DNS -------------------------------------------------------
  console.log(c.bold("\nCloudflare DNS"));
  const current = await cf(`/zones/${zone.id}/dns_records?per_page=100`, cfToken);

  for (const record of records) {
    const name = absolute(record.name);
    const type = record.type.toUpperCase();

    // The guard. Inbound mail lives at the apex and is not ours to rewrite.
    if (name === DOMAIN && (type === "MX" || type === "TXT")) {
      die(
        `Resend asked for a ${type} record at the apex (${DOMAIN}).`,
        "That is where Cloudflare Email Routing's MX and SPF live. Writing it would\n" +
          "break inbound mail. Nothing has been changed — resolve this by hand.",
      );
    }

    const found = (current.result ?? []).find(
      (r) => r.name === name && r.type === type,
    );

    const body = {
      type,
      name,
      content: record.value,
      ttl: 1,
      proxied: false,
      ...(record.priority !== undefined && record.priority !== null
        ? { priority: record.priority }
        : {}),
    };

    if (found && found.content === record.value) {
      same(`${type} ${name}`);
      continue;
    }

    if (!APPLY) {
      would(`${found ? "update" : "create"} ${type} ${name}`);
      continue;
    }

    if (found) {
      await cf(`/zones/${zone.id}/dns_records/${found.id}`, cfToken, { method: "PATCH", body });
      did(`update ${type} ${name}`);
    } else {
      await cf(`/zones/${zone.id}/dns_records`, cfToken, { method: "POST", body });
      did(`create ${type} ${name}`);
    }
  }

  if (!APPLY) {
    console.log("\n  Re-run with --apply to act.\n");
    return;
  }

  // --- Ask Resend to check -------------------------------------------------
  console.log(c.bold("\nVerification"));
  await resend(`/domains/${domain.id}/verify`, adminKey, { method: "POST" });
  did("asked Resend to verify");

  // DNS needs a moment to propagate; a couple of polls is usually enough, and
  // failing to go green here is not an error — it just takes longer sometimes.
  let status = "pending";
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const check = await resend(`/domains/${domain.id}`, adminKey);
    status = check.status;
    if (status === "verified") break;
  }
  console.log(
    status === "verified"
      ? `  ${c.green("✓")} domain verified — sending is live`
      : `  ${c.amber("!")} status is "${status}". DNS can take a few minutes; re-run to re-check.`,
  );

  // --- Push the sending key to Vercel --------------------------------------
  if (vercelToken && sendKey) {
    console.log(c.bold("\nVercel"));
    const teams = await api("https://api.vercel.com/v2/teams", {
      token: vercelToken,
      label: "Vercel teams",
    });
    const team = (teams.teams ?? []).find((t) => t.slug !== "leadlynk-projects");
    if (team) {
      for (const [key, value] of [
        ["RESEND_API_KEY", sendKey],
        ["EMAIL_FROM", env.EMAIL_FROM || `iWaiver <notifications@${DOMAIN}>`],
      ]) {
        try {
          await api(
            `https://api.vercel.com/v10/projects/${PROJECT}/env?teamId=${team.id}&upsert=true`,
            {
              token: vercelToken,
              method: "POST",
              label: `Vercel env ${key}`,
              body: {
                key,
                value,
                type: key === "RESEND_API_KEY" ? "sensitive" : "encrypted",
                target: ["production", "preview", "development"],
              },
            },
          );
          did(`set ${key}`);
        } catch (error) {
          console.log(`  ${c.amber("!")} ${key}: ${error.message}`);
        }
      }
      console.log(
        `\n  ${c.dim("Redeploy for these to take effect: npx vercel deploy --prod")}`,
      );
    }
  }

  console.log(
    `\n  ${c.amber("Now delete RESEND_ADMIN_API_KEY")} — from .env.local and from the Resend dashboard.\n`,
  );
}

main().catch((error) => {
  console.error(`\n${c.red("FAILED")} ${error.message}\n`);
  process.exit(1);
});
