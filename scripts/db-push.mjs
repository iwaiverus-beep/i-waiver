#!/usr/bin/env node
/**
 * Applies pending migrations to the iWaiver Supabase project.
 *
 * This exists because `supabase db push` does not work on this machine: the CLI
 * rejects the newer `sbp_v0_` personal access token format, and the ambient
 * SUPABASE_ACCESS_TOKEN is a LeadLynk publishable key that shadows it anyway.
 * The Management API accepts the token fine, so this drives that instead.
 *
 * It matches the CLI's behaviour in the ways that matter: migrations run in
 * filename order, only pending ones run, and each is recorded in
 * supabase_migrations.schema_migrations so history stays consistent with what
 * `supabase migration list` would report.
 *
 * ---------------------------------------------------------------------------
 * ISOLATION, same rule as scripts/setup-deploy.mjs
 *
 * Credentials come from iWaiver/.env.local, never the ambient environment, and
 * preflight refuses to continue unless the token resolves to exactly one project
 * whose ref matches SUPABASE_PROJECT_REF. A token that can see somebody else's
 * project stops the run rather than migrating it.
 * ---------------------------------------------------------------------------
 *
 *   node scripts/db-push.mjs            # dry run: lists what would apply
 *   node scripts/db-push.mjs --apply    # actually applies
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const APPLY = process.argv.includes("--apply");

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
      `${path} (${response.status}): ${json?.message || json?.error || text.slice(0, 400)}`,
    );
  }
  return json;
}

const sql = (ref, token, query) =>
  management(`/v1/projects/${ref}/database/query`, token, {
    method: "POST",
    body: { query },
  });

async function main() {
  console.log(
    c.bold(`\niWaiver migrations ${APPLY ? c.red("— APPLYING") : c.dim("— dry run")}`),
  );

  const env = readEnvFile();
  const token = env.SUPABASE_ACCESS_TOKEN;
  const ref = env.SUPABASE_PROJECT_REF;

  if (!token) die("SUPABASE_ACCESS_TOKEN is not set in .env.local.");
  if (!ref) die("SUPABASE_PROJECT_REF is not set in .env.local.");

  // --- Preflight: exactly one project, and it is the one we mean ------------
  const projects = await management("/v1/projects", token);
  const visible = (projects ?? []).map((p) => p.id);

  if (!visible.includes(ref)) {
    die(
      `This token cannot see project ${ref}.`,
      `It sees: ${visible.join(", ") || "(none)"}`,
    );
  }
  if (visible.length > 1) {
    die(
      `This token can reach ${visible.length} projects: ${visible.join(", ")}.`,
      "Scope it to the iWaiver project only, so a migration cannot land elsewhere.",
    );
  }

  const project = projects.find((p) => p.id === ref);
  console.log(`  ${c.green("✓")} project ${c.bold(project.name)} (${ref})`);

  // --- What is already applied? --------------------------------------------
  const applied = new Set(
    (
      await sql(
        ref,
        token,
        "select version from supabase_migrations.schema_migrations order by version;",
      )
    ).map((r) => r.version),
  );

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pending = files.filter((f) => !applied.has(f.split("_")[0]));

  console.log(
    `  ${c.dim(`${applied.size} applied, ${pending.length} pending`)}\n`,
  );

  if (pending.length === 0) {
    console.log(`  ${c.green("Nothing to do — the database is up to date.")}\n`);
    return;
  }

  for (const file of pending) {
    const version = file.split("_")[0];
    const name = basename(file, ".sql").slice(version.length + 1);

    if (!APPLY) {
      console.log(`  ${c.amber("→")} would apply ${file}`);
      continue;
    }

    process.stdout.write(`  ${c.dim("…")} ${file}`);
    const body = readFileSync(join(MIGRATIONS, file), "utf8");

    try {
      await sql(ref, token, body);
    } catch (error) {
      process.stdout.write("\r");
      die(
        `${file} failed.\n\n  ${error.message}`,
        "Nothing after this migration was attempted. Fix it and re-run —\n" +
          "already-applied migrations are skipped, so this is safe to repeat.",
      );
    }

    // Record it the way the CLI would, so `supabase migration list` agrees with
    // reality. `statements` is left empty: it is only used by the CLI's own
    // repair flow, and storing a fabricated split would be worse than nothing.
    await sql(
      ref,
      token,
      `insert into supabase_migrations.schema_migrations (version, name)
       values ('${version}', '${name.replace(/'/g, "''")}')
       on conflict (version) do nothing;`,
    );

    process.stdout.write(`\r  ${c.green("✓")} ${file}    \n`);
  }

  console.log();
  if (!APPLY) console.log("  Re-run with --apply to act.\n");
  else console.log(`  ${c.green("Done.")}\n`);
}

main().catch((error) => {
  console.error(`\n${c.red("FAILED")} ${error.message}\n`);
  process.exit(1);
});
