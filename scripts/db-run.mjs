#!/usr/bin/env node
/**
 * Runs one SQL file against the iWaiver Supabase project.
 *
 * For the things that are deliberately NOT migrations — chiefly
 * supabase/seed/dev_publish_specimen_clauses.sql, which publishes placeholder
 * legal wording and must never be in the migration chain.
 *
 * Same isolation rule as db-push.mjs and setup-deploy.mjs: credentials come from
 * .env.local, and the run stops unless the token resolves to exactly one project
 * matching SUPABASE_PROJECT_REF.
 *
 * Anything under supabase/seed/ is treated as consequential: it prints the file's
 * header comment and requires --apply, so running one is always a deliberate act
 * against a named database rather than a reflex.
 *
 *   node scripts/db-run.mjs supabase/seed/dev_publish_specimen_clauses.sql
 *   node scripts/db-run.mjs supabase/seed/dev_publish_specimen_clauses.sql --apply
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const target = process.argv.slice(2).find((a) => !a.startsWith("--"));

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

async function management(path, token, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.supabase.com${path}`, {
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
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(
      json?.message || json?.error || `${response.status}: ${text.slice(0, 400)}`,
    );
  }
  return json;
}

async function main() {
  if (!target) die("Usage: node scripts/db-run.mjs <file.sql> [--apply]");

  const path = resolve(ROOT, target);
  if (!existsSync(path)) die(`No such file: ${target}`);

  const body = readFileSync(path, "utf8");
  const rel = relative(ROOT, path).replace(/\\/g, "/");

  console.log(
    c.bold(`\nRun ${rel} ${APPLY ? c.red("— APPLYING") : c.dim("— dry run")}`),
  );

  const env = readEnvFile();
  const token = env.SUPABASE_ACCESS_TOKEN;
  const ref = env.SUPABASE_PROJECT_REF;
  if (!token) die("SUPABASE_ACCESS_TOKEN is not set in .env.local.");
  if (!ref) die("SUPABASE_PROJECT_REF is not set in .env.local.");

  const projects = await management("/v1/projects", token);
  const visible = (projects ?? []).map((p) => p.id);
  if (!visible.includes(ref)) die(`This token cannot see project ${ref}.`);
  if (visible.length > 1) {
    die(`This token can reach ${visible.length} projects: ${visible.join(", ")}.`);
  }

  const project = projects.find((p) => p.id === ref);
  console.log(`  ${c.green("✓")} project ${c.bold(project.name)} (${ref})`);

  // Seeds carry a warning in their header for a reason. Show it, every time.
  if (rel.includes("supabase/seed/")) {
    const header = body
      .split("\n")
      .filter((l) => l.startsWith("--"))
      .slice(0, 12)
      .map((l) => `  ${c.amber(l)}`)
      .join("\n");
    console.log(`\n${header}\n`);
  }

  if (!APPLY) {
    console.log(`  ${c.amber("→")} would execute ${body.length} bytes of SQL`);
    console.log("\n  Re-run with --apply to act.\n");
    return;
  }

  const result = await management(
    `/v1/projects/${ref}/database/query`,
    token,
    { method: "POST", body: { query: body } },
  );

  console.log(`  ${c.green("✓")} executed`);
  if (Array.isArray(result) && result.length > 0) {
    console.log(`  ${c.dim(JSON.stringify(result).slice(0, 300))}`);
  }
  console.log();
}

main().catch((error) => {
  console.error(`\n${c.red("FAILED")} ${error.message}\n`);
  process.exit(1);
});
