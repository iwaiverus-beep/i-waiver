#!/usr/bin/env node
/**
 * Puts our name on the emails Supabase Auth sends.
 *
 * Two separate problems, and the difference matters:
 *
 *   THE CONTENT is a set of templates in the project's auth config. They start
 *   as Supabase's defaults — a bare heading, and a footer reading "powered by
 *   Supabase". `supabase/templates/*.html` replaces them.
 *
 *   THE SENDER is SMTP. Until a project sets its own, Auth sends through
 *   Supabase's shared address, and no template can change that: the From line
 *   says Supabase because Supabase is the one sending. Pointing it at the Resend
 *   account the product already uses makes the From line the same address a
 *   borrower sees on a signing link. It also lifts the shared sender's cap of a
 *   few messages an hour, which is a testing allowance rather than a limit a
 *   real signup flow can live inside.
 *
 * Nothing here sends an email.
 *
 *   node scripts/setup-auth-emails.mjs            # dry run: says what would change
 *   node scripts/setup-auth-emails.mjs --apply
 *   node scripts/setup-auth-emails.mjs --revert-smtp --apply
 *
 * `--revert-smtp` hands sending back to Supabase's shared address, keeping the
 * templates. That is the way back if mail stops arriving after this runs, and it
 * is worth knowing about before it is needed rather than after.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect } from "node:tls";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const REVERT_SMTP = process.argv.includes("--revert-smtp");

/** Resend's SMTP relay. The username is the literal word; the password is the API key. */
const SMTP = { host: "smtp.resend.com", port: 465, user: "resend" };

/**
 * Confirmations, resets and sign-in links an hour, project-wide. Deliberately not
 * generous: this ceiling is the only thing standing between a script pointed at
 * the signup form and our Resend reputation, and every one of these messages is
 * sent to an address nobody has proven they own yet.
 */
const AUTH_EMAILS_PER_HOUR = 60;

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
const note = (s) => console.log(`  ${c.dim(s)}`);

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

/**
 * The brand comes out of lib/brand.ts rather than being spelled out here.
 * CLAUDE.md promises renaming the product is a one-line change in that file, and
 * an email signed with a name copied into a script is exactly how that promise
 * quietly stops being true.
 */
function readBrand() {
  const source = readFileSync(join(ROOT, "lib", "brand.ts"), "utf8");
  const value = (key) => source.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1];
  const name = value("name");
  const domain = value("domain");
  if (!name || !domain) die("Could not read name and domain out of lib/brand.ts.");
  return { name, domain };
}

/** `I-Waiver <notifications@i-waiver.com>` into its two halves. */
function parseFrom(value) {
  const angled = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (angled) return { name: angled[1].replace(/^"|"$/g, ""), address: angled[2] };
  return { name: null, address: value.trim() };
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
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(
      `Supabase ${path} (${response.status}): ${json?.message || text.slice(0, 300)}`,
    );
  }
  return json;
}

/**
 * Opens an SMTP session, authenticates, and hangs up without sending anything.
 *
 * Worth the forty lines: the alternative is handing Supabase a credential nobody
 * has tried, and finding out it was wrong from a user who never got their
 * confirmation email. It proves the password works. It cannot prove the sending
 * domain is verified at Resend — that is only refused later, at the point a
 * message is actually handed over — so the domain is checked separately.
 */
function smtpCheck({ host, port, user, pass }) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername: host });
    socket.setEncoding("utf8");
    socket.setTimeout(15000);

    const steps = [
      { expect: 220, send: "EHLO i-waiver.com" },
      { expect: 250, send: "AUTH LOGIN" },
      { expect: 334, send: Buffer.from(user).toString("base64") },
      { expect: 334, send: Buffer.from(pass).toString("base64") },
      { expect: 235, send: "QUIT" },
    ];

    let step = 0;
    let buffer = "";
    let settled = false;

    const fail = (message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(message));
    };
    const done = () => {
      if (settled) return;
      settled = true;
      socket.end();
      resolve();
    };

    socket.on("timeout", () => fail(`${host}:${port} did not answer within 15s.`));
    socket.on("error", (error) => fail(`${host}:${port} — ${error.message}`));
    socket.on("close", () => fail(`${host}:${port} hung up mid-handshake.`));

    socket.on("data", (chunk) => {
      // The server's "221 goodbye" lands after QUIT, once there is no step left
      // to match it against.
      if (settled) return;
      buffer += chunk;
      // A multi-line reply repeats the code with a hyphen; only "250 " ends it.
      let match;
      while ((match = buffer.match(/^(\d{3})[- ][^\r\n]*\r\n/))) {
        const line = match[0];
        buffer = buffer.slice(line.length);
        if (/^\d{3}-/.test(line)) continue;

        const code = Number(match[1]);
        const current = steps[step];
        if (code !== current.expect) {
          return fail(
            `${host} answered ${code} where ${current.expect} was expected: ${line.trim()}`,
          );
        }
        socket.write(`${current.send}\r\n`);
        step += 1;
        if (step === steps.length) return done();
      }
    });
  });
}

/**
 * Resend refuses a From address on a domain it has not verified, and that
 * refusal happens when a message is handed over — which for us means silently,
 * inside Supabase, on somebody's signup. Checking needs a full-access key, which
 * the deployed app deliberately does not hold; the sending-only key it does hold
 * cannot read this. So the check runs when RESEND_ADMIN_API_KEY happens to be
 * present, and is reported as unproven when it is not.
 */
async function domainStatus(adminKey, domain) {
  if (!adminKey) return null;
  const response = await fetch("https://api.resend.com/domains", {
    headers: { authorization: `Bearer ${adminKey}` },
  });
  if (!response.ok) return null;
  const body = await response.json();
  const row = (body.data ?? []).find((d) => d.name === domain);
  return row ? row.status : "missing";
}

async function main() {
  const brand = readBrand();
  console.log(
    c.bold(`\n${brand.name} auth emails ${APPLY ? c.red("— APPLYING") : c.dim("— dry run")}`),
  );

  const env = readEnvFile();
  const token = env.SUPABASE_ACCESS_TOKEN;
  const ref = env.SUPABASE_PROJECT_REF;
  if (!token) die("SUPABASE_ACCESS_TOKEN is not in .env.local.");
  if (!ref) die("SUPABASE_PROJECT_REF is not in .env.local.");

  const siteUrl = (env.NEXT_PUBLIC_SITE_URL || `https://www.${brand.domain}`).replace(
    /\/+$/,
    "",
  );
  const substitutions = {
    "[[BRAND_NAME]]": brand.name,
    "[[BRAND_DOMAIN]]": brand.domain,
    "[[SITE_URL]]": siteUrl,
  };
  const render = (text) =>
    Object.entries(substitutions).reduce((out, [from, to]) => out.split(from).join(to), text);

  const templates = {
    confirmation: {
      file: "confirmation.html",
      subject: "Confirm your email address for [[BRAND_NAME]]",
    },
    recovery: { file: "recovery.html", subject: "Reset your [[BRAND_NAME]] password" },
    magic_link: { file: "magic-link.html", subject: "Your [[BRAND_NAME]] sign-in link" },
    invite: { file: "invite.html", subject: "You have been invited to [[BRAND_NAME]]" },
    email_change: {
      file: "email-change.html",
      subject: "Confirm your new email address for [[BRAND_NAME]]",
    },
    reauthentication: {
      file: "reauthentication.html",
      subject: "{{ .Token }} is your [[BRAND_NAME]] verification code",
    },
  };

  const desired = {};
  for (const [key, { file, subject }] of Object.entries(templates)) {
    const path = join(ROOT, "supabase", "templates", file);
    if (!existsSync(path)) die(`supabase/templates/${file} is missing.`);
    const html = render(readFileSync(path, "utf8"));
    // A leftover placeholder would be shipped verbatim to somebody's inbox.
    const stray = html.match(/\[\[[A-Z_]+\]\]/);
    if (stray) die(`supabase/templates/${file} still contains ${stray[0]}.`);
    desired[`mailer_subjects_${key}`] = render(subject);
    desired[`mailer_templates_${key}_content`] = html;
  }

  console.log(c.bold("\nSender"));

  if (REVERT_SMTP) {
    Object.assign(desired, {
      smtp_host: null,
      smtp_port: null,
      smtp_user: null,
      smtp_pass: null,
      smtp_admin_email: null,
      smtp_sender_name: null,
      // The shared sender will not carry more than this whatever the field says.
      rate_limit_email_sent: 2,
    });
    note("--revert-smtp: sending goes back to Supabase's shared address.");
  } else {
    const key = env.RESEND_API_KEY;
    if (!key) die("RESEND_API_KEY is not in .env.local, so there is nothing to send through.");
    const from = parseFrom(env.EMAIL_FROM || `${brand.name} <notifications@${brand.domain}>`);

    const status = await domainStatus(env.RESEND_ADMIN_API_KEY, brand.domain);
    if (status === "verified") {
      did(`${brand.domain} is verified at Resend`);
    } else if (status) {
      die(
        `Resend reports ${brand.domain} as "${status}", not verified.`,
        "Run scripts/setup-email.mjs --apply and wait for the DNS to be checked.\n" +
          "Switching Supabase onto an unverified domain would stop auth email dead.",
      );
    } else {
      note(
        "Could not confirm the sending domain is verified at Resend — that needs\n" +
          "  RESEND_ADMIN_API_KEY, which is not set. If notifications@ already works\n" +
          "  for signing links, it is verified.",
      );
    }

    process.stdout.write(c.dim("  · testing the SMTP credential… "));
    try {
      await smtpCheck({ ...SMTP, pass: key });
      console.log(c.green("accepted"));
    } catch (error) {
      console.log("");
      die(error.message, "Supabase is not being given a credential that does not work.");
    }

    Object.assign(desired, {
      smtp_host: SMTP.host,
      smtp_port: String(SMTP.port),
      smtp_user: SMTP.user,
      smtp_pass: key,
      smtp_admin_email: from.address,
      smtp_sender_name: from.name || brand.name,
      // The shared sender's allowance is a handful an hour, and it stays in force
      // as a separate setting even once the mail is going out through Resend. Two
      // an hour is a number a single afternoon of testing exhausts, and the
      // failure is invisible from inside the product: signup succeeds, the email
      // is simply never sent.
      rate_limit_email_sent: AUTH_EMAILS_PER_HOUR,
    });
  }

  const current = await management(`/v1/projects/${ref}/config/auth`, token);

  const changes = {};
  for (const [key, value] of Object.entries(desired)) {
    // The password never comes back from the API, so it can only ever be written.
    if (key === "smtp_pass") {
      if (!REVERT_SMTP) changes[key] = value;
      else if (current.smtp_host) changes[key] = value;
      continue;
    }
    if (String(current[key] ?? "") !== String(value ?? "")) changes[key] = value;
  }

  console.log(c.bold("\nChanges"));

  const describe = (key) =>
    key.startsWith("mailer_templates_")
      ? `${key} (${desired[key].length} bytes of HTML)`
      : key === "smtp_pass"
        ? "smtp_pass (the Resend key, write-only)"
        : `${key} = ${JSON.stringify(desired[key])}`;

  const keys = Object.keys(changes);
  if (keys.length === 0) {
    same("every field");
  } else {
    for (const key of keys) (APPLY ? did : would)(describe(key));
  }

  if (keys.length > 0 && APPLY) {
    await management(`/v1/projects/${ref}/config/auth`, token, {
      method: "PATCH",
      body: changes,
    });
    console.log(`\n${c.green("Applied.")} Sign up with a throwaway address to see it.`);
  } else if (keys.length > 0) {
    console.log(`\n${c.dim("Nothing was changed. Re-run with --apply.")}`);
  }

  console.log(c.bold("\nWorth knowing"));
  note(
    `Auth email is rate limited to ${current.rate_limit_email_sent ?? "?"} an hour, project-wide.`,
  );
  note(
    "Templates and sender are project settings, not code. A branch or a second\n" +
      "  project starts from Supabase's defaults again — re-run this there.",
  );
  console.log("");
}

main().catch((error) => die(error.message));
