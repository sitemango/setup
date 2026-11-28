#!/usr/bin/env node
/**
 * `npm run club-logos:register` — register the 17 club marks through the same
 * private Campus+ Apps Script gateway used for every Campus+ storage upload.
 *
 * The gateway (integrations/google-apps-script/Code.gs) only serves Drive
 * files named `campus-upload-v3-<key>` that live in the storage folder, so a
 * file uploaded by hand to Drive can never be served by the site. This script
 * closes that gap: it takes the 17 mark files as they exist on your machine,
 * uploads each with a fresh v3 key through the signed `upload_v3` operation,
 * then rewrites the IDs in `lib/clubs/logos.js` atomically.
 *
 * Safe by default: without `--apply` it only validates (preflight) and prints
 * the plan. With `--apply` it uploads sequentially and stops at the first
 * failure — the table is rewritten only when ALL 17 succeed, and any IDs that
 * were already uploaded are printed so nothing is lost track of.
 *
 * Usage:
 *   node scripts/register-club-logos.mjs --from /path/to/folder            # preflight only
 *   node scripts/register-club-logos.mjs --from /path/to/folder --apply    # upload + patch table
 *   node scripts/register-club-logos.mjs --from . --logos /tmp/copy.js --apply
 *
 * Prerequisites: GOOGLE_APPS_SCRIPT_URL and GOOGLE_APPS_SCRIPT_SHARED_SECRET
 * in the environment or in .env.local (the same values the app uses). The
 * folder must contain files with the EXACT names below — they are matched
 * one-to-one with catalogue slugs; anything else in it is ignored.
 */

import { rename, readFile, writeFile } from 'node:fs/promises';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadEnv, requireValue, parseArgs, banner, ok, bad, warn, root } from './lib/env.mjs';
import { validateFile, MAX_FILE_BYTES } from '../lib/storage/validation.js';

// Exact file name → catalogue slug. Verified image-by-image against the marks.
const FILE_TO_SLUG = [
  ['WhatsApp Image 2026-11-28 at 11.28.34 (1).jpeg', 'ciesa'],
  ['WhatsApp Image 2026-11-28 at 11.28.34.jpeg', 'aimsa'],
  ['WhatsApp Image 2026-11-28 at 11.28.35 (1).jpeg', 'mlsc-pccoe'],
  ['WhatsApp Image 2026-11-28 at 11.28.35 (2).jpeg', 'etsa'],
  ['WhatsApp Image 2026-11-28 at 11.28.35.jpeg', 'cresa'],
  ['WhatsApp Image 2026-11-28 at 11.28.37 (1).jpeg', 'gdg-campus'],
  ['WhatsApp Image 2026-11-28 at 11.28.37 (2).jpeg', 'itsa'],
  ['WhatsApp Image 2026-11-28 at 11.28.37.jpeg', 'mesa'],
  ['WhatsApp Image 2026-11-28 at 11.28.38 (1).jpeg', 'owasp-pccoe'],
  ['WhatsApp Image 2026-11-28 at 11.28.38 (2).jpeg', 'acm-w-pccoe'],
  ['WhatsApp Image 2026-11-28 at 11.28.38.jpeg', 'team-solarium'],
  ['WhatsApp Image 2026-11-28 at 11.28.39 (1).jpeg', 'acm-pccoe'],
  ['WhatsApp Image 2026-11-28 at 11.28.39.jpeg', 'team-ambush'],
  ['WhatsApp Image 2026-11-28 at 11.28.40 (1).jpeg', 'team-anantam'],
  ['WhatsApp Image 2026-11-28 at 11.28.40 (2).jpeg', 'team-kratos-racing-electric'],
  ['WhatsApp Image 2026-11-28 at 11.28.40.jpeg', 'team-automatons'],
  ['WhatsApp Image 2026-11-28 at 11.28.41.jpeg', 'team-maverick-india'],
];

const ID_REGEX = /^[A-Za-z0-9_-]{10,200}$/;
const V3_KEY_REGEX = /^[0-9]{13}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function usage() {
  console.log(`\n  Register the 17 club marks through the Campus+ gateway.\n
  --from <dir>     Folder holding the 17 files (default: current directory)
  --apply          Upload and rewrite lib/clubs/logos.js (default: preflight only)
  --logos <path>   Table to rewrite (default: <repo>/lib/clubs/logos.js)
  --help           Show this help\n`);
}

function gatewayUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port || url.username || url.password || url.search || url.hash || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) throw new Error('bad');
    return url.href;
  } catch {
    bad('GOOGLE_APPS_SCRIPT_URL must look like https://script.google.com/macros/s/<id>/exec (the deployed web app).');
    process.exit(1);
  }
}

/** Signed gateway call, mirroring lib/storage/google-apps-script.js. */
async function call({ url, secret, timeoutMs = 25000 }, payload) {
  const serialized = JSON.stringify(payload);
  const envelope = {
    timestamp: Date.now(),
    nonce: randomBytes(16).toString('hex'),
    requestId: randomUUID(),
    payload: serialized,
  };
  envelope.signature = createHmac('sha256', secret)
    .update(`${envelope.timestamp}\n${envelope.nonce}\n${envelope.requestId}\n${serialized}`, 'utf8')
    .digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: controller.signal,
      redirect: 'manual',
      cache: 'no-store',
    });
    if (response.status === 302 || response.status === 303) {
      const redirect = new URL(response.headers.get('location'));
      if (redirect.protocol !== 'https:' || redirect.hostname !== 'script.googleusercontent.com' || redirect.port || redirect.username || redirect.password) throw new Error('storage_unavailable');
      response = await fetch(redirect.href, { method: 'GET', signal: controller.signal, redirect: 'error', cache: 'no-store' });
    }
    const text = await response.text();
    let result = null;
    try { result = JSON.parse(text); } catch { /* handled below */ }
    if (!response.ok || !result) throw new Error('storage_unavailable');
    if (!result.ok) throw new Error(`gateway:${result.code || 'error'}`);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadOne(config, { name, bytes }) {
  const key = `${Date.now()}-${randomUUID()}`;
  if (!V3_KEY_REGEX.test(key)) throw new Error('internal key generation failed');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const result = await call(config, {
    operation: 'upload_v3',
    key,
    name,
    mime: 'image/jpeg',
    base64: bytes.toString('base64'),
    checksum,
  });
  if (!ID_REGEX.test(result.id || '') || result.size !== bytes.length || result.mime !== 'image/jpeg' || result.checksum !== checksum) {
    throw new Error('gateway returned an unverifiable upload');
  }
  return result.id;
}

/** Rewrite exactly the 17 known entries; refuse to write a partially matched table. */
async function patchTable(tablePath, idsBySlug) {
  const original = await readFile(tablePath, 'utf8');
  let next = original;
  for (const [, slug] of FILE_TO_SLUG) {
    const id = idsBySlug[slug];
    const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`(['"]${esc}['"]\\s*:\\s*)'[^']*'`),
      new RegExp(`(\\b${esc}\\s*:\\s*)'[^']*'`),
    ];
    let replaced = false;
    for (const pattern of patterns) {
      if (pattern.test(next)) { next = next.replace(pattern, `$1'${id}'`); replaced = true; break; }
    }
    if (!replaced) throw new Error(`table entry for "${slug}" not found in ${tablePath}; leaving it untouched`);
  }
  // Sanity: after the rewrite every targeted entry must match the ID regex.
  for (const [, slug] of FILE_TO_SLUG) {
    const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:['"]${esc}['"]|\\b${esc})\\s*:\\s*'([A-Za-z0-9_-]{10,200})'`);
    if (!re.test(next)) throw new Error(`table rewrite for "${slug}" did not verify; leaving the file untouched`);
  }
  const tmp = `${tablePath}.tmp`;
  await writeFile(tmp, next);
  await rename(tmp, tablePath);
}

const args = parseArgs();
if (args.help) { usage(); process.exit(0); }

const fromDir = typeof args.from === 'string' ? path.resolve(args.from) : process.cwd();
const tablePath = typeof args.logos === 'string' ? path.resolve(args.logos) : path.join(root, 'lib', 'clubs', 'logos.js');
const apply = args.apply === true;

banner('Campus+ club logos');

// ── Preflight: every file must exist and sniff as a JPEG before ANY upload ──
const problems = [];
const prepared = [];
for (const [name, slug] of FILE_TO_SLUG) {
  const file = path.join(fromDir, name);
  let bytes = null;
  try {
    bytes = await readFile(file);
  } catch {
    problems.push(`missing: ${name}`);
    continue;
  }
  if (bytes.length < 1 || bytes.length > MAX_FILE_BYTES) {
    problems.push(`${name}: ${bytes.length} bytes exceeds the 3 MiB storage cap`);
    continue;
  }
  const check = validateFile({ name, mime: 'image/jpeg', bytes });
  if (!check.ok) {
    problems.push(`${name}: failed the JPEG signature check (${check.code})`);
    continue;
  }
  prepared.push({ name, slug, bytes });
}

if (problems.length) {
  for (const problem of problems) bad(problem);
  bad(`Preflight failed — nothing was uploaded. Folder: ${fromDir}`);
  process.exit(1);
}
ok(`Preflight: all ${prepared.length} marks present and valid (${prepared.reduce((n, f) => n + f.bytes.length, 0)} bytes total)`);
if (!apply) {
  console.log(`\n  Dry run — nothing was uploaded. Re-run with --apply to upload through the gateway and rewrite ${tablePath}.\n`);
  process.exit(0);
}

// ── Upload through the existing gateway, sequentially ────────────────────────
const env = await loadEnv();
const url = gatewayUrl(requireValue(env, 'GOOGLE_APPS_SCRIPT_URL', 'Set GOOGLE_APPS_SCRIPT_URL (the deployed /exec URL) in .env.local or the environment.'));
const secret = requireValue(env, 'GOOGLE_APPS_SCRIPT_SHARED_SECRET', 'Set GOOGLE_APPS_SCRIPT_SHARED_SECRET in .env.local or the environment.');
if (typeof secret !== 'string' || secret.length < 32) {
  bad('GOOGLE_APPS_SCRIPT_SHARED_SECRET must be at least 32 characters.');
  process.exit(1);
}
const config = { url, secret };

const idsBySlug = {};
const uploaded = [];
for (const { name, slug, bytes } of prepared) {
  try {
    const id = await uploadOne(config, { name, bytes });
    idsBySlug[slug] = id;
    uploaded.push({ slug, id });
    ok(`${slug.padEnd(28)} ${id}`);
  } catch (error) {
    bad(`${slug}: ${error.message}`);
    if (uploaded.length) {
      warn('Already uploaded (left in place; table NOT rewritten):');
      for (const entry of uploaded) console.log(`     ${entry.slug} = ${entry.id}`);
    }
    bad('Upload failed — lib/clubs/logos.js was not modified.');
    process.exit(1);
  }
}

try {
  await patchTable(tablePath, idsBySlug);
} catch (error) {
  bad(error.message);
  warn('The uploads above succeeded; pass these IDs manually or fix the table:');
  for (const entry of uploaded) console.log(`     ${entry.slug} = ${entry.id}`);
  process.exit(1);
}
ok(`Wrote ${tablePath}`);
console.log('\n  Next: review `git diff lib/clubs/logos.js`, commit, and deploy. Clubs without an ID keep the monogram fallback.\n');
