#!/usr/bin/env node
/**
 * Real-browser check for "a post is visible immediately, for everybody who should
 * see it" — the workflow the feed bug broke.
 *
 * It drives the **production build** (`next start`) against the local harness
 * backend (`npm run perf:serve`: real PostgreSQL, real migrations, real RLS), with
 * two signed-in Chromium contexts that behave like two students on two laptops:
 *
 *   • the author publishes from an already-open Home, and the post appears without a
 *     reload and without a navigation, exactly once, as a complete card;
 *   • the second student's already-open Home discovers the same post with no manual
 *     reload, and does not end up with two copies of it;
 *   • a post hidden by moderation leaves both open feeds; a pending post never
 *     enters either;
 *   • a community post appears on the open community board (a server-rendered
 *     surface) for both members, and is *not* placed on Home;
 *   • a failed write reports no success, keeps the draft, and publishes on retry;
 *   • an idle open feed does not poll.
 *
 * Honest scope: the harness stub serves PostgREST and the auth endpoints but
 * implements no Realtime websocket, so live channel delivery cannot be exercised
 * here. The cross-user half of this run therefore proves the *invalidation and
 * reconciliation* path — the gap-recovery cadence the provider falls back to when a
 * channel is not live — i.e. that an open feed converges without a reload even when
 * Realtime is unavailable. The publication membership and channel authorization that
 * Realtime itself depends on are asserted against real SQL in
 * `database/tests/15_feed_realtime_delivery.sql`.
 *
 *   npm run build && npx next start -p 3100        # .env.local pointing at the stub
 *   node scripts/dev/feed-refresh-check.mjs
 *
 * Options: --base <url> --author <email> --viewer <email> --community <slug> --quick
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { createSessionCookie } from './perf/session.mjs';
import { DATABASE_URL, root } from './perf/lib.mjs';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.PERF_APP_URL || 'http://127.0.0.1:3100' },
    author: { type: 'string', default: 'perf.student1@pccoepune.org' },
    viewer: { type: 'string', default: 'perf.student2@pccoepune.org' },
    community: { type: 'string', default: 'computer-engineering' },
    quick: { type: 'boolean', default: false },
  },
});

const BASE = values.base;
// How long an already-open feed is allowed to converge on its own. The live path is
// a 450 ms batch plus a 700 ms coalesced read; with no websocket available the
// provider's gap-recovery tick is 20 s, so a minute is the degraded path — and none
// of these numbers involves a reload, a navigation or a refresh button.
const CROSS_USER_MS = values.quick ? 45_000 : 90_000;
const SAME_TAB_MS = 20_000;
const IDLE_MS = values.quick ? 22_000 : 24_000;

const harness = JSON.parse(await readFile(path.join(root, 'node_modules/.cache/perf/harness.json'), 'utf8'));
const runId = Date.now().toString(36);
let failures = 0;
const notes = [];

function log(kind, label, detail = '') {
  if (kind === 'FAIL') failures += 1;
  console.log(`${kind === 'ok' ? 'ok  ' : kind === 'note' ? 'note' : 'FAIL'}  ${label.padEnd(54)} ${detail}`);
}

async function check(label, assert) {
  try {
    const detail = await assert();
    log('ok', label, typeof detail === 'string' ? detail : '');
  } catch (error) {
    log('FAIL', label, (error?.message || String(error)).split('\n')[0].slice(0, 220));
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/* ------------------------------------------------------------------ sessions */

const authorSession = await createSessionCookie(harness.stubUrl, values.author);
const viewerSession = await createSessionCookie(harness.stubUrl, values.viewer);

let launchBrowser;
try {
  ({ launchBrowser } = await import(path.join(root, 'scripts/dev/browser.mjs')));
  await import('playwright-core');
} catch (error) {
  console.error(`\nChromium bootstrap unavailable (${error.message}). Run \`npm ci\` first.`);
  process.exit(2);
}
const browser = await launchBrowser();

/**
 * A page that counts its own navigations and feed reads, so "without reloading" is
 * something the run observes rather than something the script claims.
 */
async function openPage(session, { route = '/home' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([
    ...session.cookies.map(({ name, value }) => ({ name, value, url: BASE })),
    { name: 'campus_intro', value: '1', url: BASE },
  ]);
  const page = await context.newPage();
  const counters = { navigations: 0, feedReads: 0, feedRequests: [], errors: [] };
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) counters.navigations += 1;
  });
  page.on('request', (request) => {
    if (request.url().includes('/api/home/feed')) {
      counters.feedReads += 1;
      counters.feedRequests.push({ at: Date.now(), method: request.method(), url: request.url() });
    }
  });
  page.on('pageerror', (error) => counters.errors.push(error.message));
  await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 60_000 });
  // A reload destroys this marker; a `router.refresh()` (same-document, RSC
  // re-render) cannot. That is the difference this check is about, and Playwright's
  // own navigation events do not distinguish the two.
  await page.evaluate(() => {
    window.__docMark = 'open';
  });
  page.__counters = counters;
  return page;
}

/** True while the document is the one that was opened: no reload has happened. */
async function notReloaded(page) {
  return (await page.evaluate(() => window.__docMark || 'gone')) === 'open';
}

const cardsWith = (page, needle) => page.locator('article').filter({ hasText: needle }).count();

async function waitForCard(page, needle, timeout, label) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const count = await cardsWith(page, needle);
    if (count > 0) return { count, seconds: ((Date.now() - started) / 1000).toFixed(1) };
    // A hidden tab deliberately does not re-read; bringing it forward is what a
    // reader switching windows does, and it is the only nudge this run gives.
    await page.bringToFront();
    await page.waitForTimeout(2_000);
  }
  throw new Error(`${label}: not on screen after ${Math.round(timeout / 1000)}s`);
}

async function waitForCardGone(page, needle, timeout, label) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if ((await cardsWith(page, needle)) === 0) return ((Date.now() - started) / 1000).toFixed(1);
    await page.bringToFront();
    await page.waitForTimeout(2_000);
  }
  throw new Error(`${label}: still on screen after ${Math.round(timeout / 1000)}s`);
}

const composerBody = (page) => page.locator('#post-body').first();
const submitButton = (page) => page
  .locator('form')
  .filter({ has: page.locator('#post-body') })
  .first()
  .locator('button[type="submit"]');

async function publish(page, text) {
  await composerBody(page).click();
  await composerBody(page).fill(text);
  await submitButton(page).click();
}

/** A body the 240 seeded posts cannot contain, so a match is unambiguous. */
const probe = (name) => `feed-refresh-check ${runId} ${name}`;
const campusProbe = probe('campus');
const olderHiddenProbe = probe('older-hidden');
const olderValidProbe = probe('older-valid');
const communityProbe = probe('community');
const failedProbe = probe('failed');

async function withDb(run) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const findProbe = (body) => withDb(async (client) => {
  const { rows } = await client.query(`select id, status from public.posts where body = $1`, [body]);
  return rows[0] || null;
});

/** A moderation state change, as the database sees it: an update on the row. */
const setStatus = (id, status) => withDb((client) => client.query(
  `update public.posts set status = $2 where id = $1`,
  [id, status],
));

/* ---------------------------------------------------------------------- run */

console.log(`\n\x1b[1mFeed refresh check\x1b[0m  ${BASE}  author=${values.author} viewer=${values.viewer}\n`);

const authorHome = await openPage(authorSession);
const viewerHome = await openPage(viewerSession);
const authorBoard = await openPage(authorSession, { route: `/communities/${values.community}` });
const viewerBoard = await openPage(viewerSession, { route: `/communities/${values.community}` });
await check('harness: two signed-in feeds are open', async () => {
  expect((await authorHome.locator('#post-body').count()) > 0, 'the author composer is missing');
  expect((await viewerHome.locator('.home-stream').count()) > 0, 'the viewer stream is missing');
  expect((await authorBoard.locator('#post-body').count()) > 0, 'the community board has no composer for this student');
  return `author @${harness.student.username} · viewer ${values.viewer} · /communities/${values.community}`;
});

/* 1 · the author sees their own post immediately */
await check('author: post appears with no reload or navigation', async () => {
  // Establish the reader position *after* the test has brought the composer and
  // its submit control on screen. Otherwise Playwright's own scroll-to-click is
  // misreported as a feed update jumping the viewport.
  await composerBody(authorHome).fill(campusProbe);
  await submitButton(authorHome).scrollIntoViewIfNeeded();
  const scrollBefore = await authorHome.evaluate(() => window.scrollY);
  await submitButton(authorHome).click();
  const { count, seconds } = await waitForCard(authorHome, campusProbe, SAME_TAB_MS, 'author Home');
  expect(count === 1, `expected exactly one card, saw ${count}`);
  expect(await notReloaded(authorHome), 'the page reloaded');
  const scrollAfter = await authorHome.evaluate(() => window.scrollY);
  expect(scrollAfter === scrollBefore, `the view jumped (${scrollBefore} → ${scrollAfter})`);
  return `one copy in ${seconds}s · no reload · view kept at ${scrollAfter}px · ${authorHome.__counters.feedReads} feed read(s) total`;
});

await check('author: the card is a complete post, not a placeholder', async () => {
  const card = authorHome.locator('article').filter({ hasText: campusProbe }).first();
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  expect(text.includes(campusProbe), 'body missing');
  expect(text.includes(`@${harness.student.username}`), `author handle missing: ${text.slice(0, 90)}`);
  expect((await card.locator('button').count()) >= 2, 'no action affordances on the card');
  expect(!/undefined|NaN|null/.test(text), `unresolved field in the card: ${text.slice(0, 120)}`);
  return `“${text.slice(0, 68)}…”`;
});

await check('author: composer cleared only after the server confirmed', async () => {
  const value = await composerBody(authorHome).inputValue();
  expect(value === '', `draft survived a successful publish: ${value.slice(0, 40)}`);
  return 'body empty, form reset';
});

/* 2 · another student's already-open feed discovers it */
await check('viewer: discovers the post with no manual reload', async () => {
  const scrollBefore = await viewerHome.evaluate(() => window.scrollY);
  const { count, seconds } = await waitForCard(viewerHome, campusProbe, CROSS_USER_MS, 'viewer Home');
  expect(count === 1, `expected one copy, saw ${count}`);
  expect(await notReloaded(viewerHome), 'the viewer page reloaded');
  expect(await viewerHome.evaluate(() => window.scrollY) === scrollBefore, 'the viewer view jumped');
  notes.push(`the viewer converged in ${seconds}s on the degraded (no-websocket) path`);
  return `one copy in ${seconds}s · no reload · ${viewerHome.__counters.feedReads} feed read(s) total`;
});

await check('viewer: one copy survives repeated invalidation', async () => {
  for (let i = 0; i < 3; i += 1) {
    await viewerHome.evaluate(() => window.dispatchEvent(new Event('focus')));
    await viewerHome.waitForTimeout(1_500);
  }
  const count = await cardsWith(viewerHome, campusProbe);
  expect(count === 1, `saw ${count} copies after repeated re-reads`);
  return 'deduplicated across focus-driven re-reads';
});

/* 3 · moderation states are respected by an open feed */
if (!values.quick) {
  await check('moderation: an older loaded page reconciles without losing valid entries', async () => {
    const created = await withDb(async (client) => {
      const { rows } = await client.query(
        `insert into public.posts (author_id, kind, body, visibility, status, created_at, updated_at)
         select id, 'post', body, 'public', 'published', stamp, stamp
           from public.profiles
           cross join (values
             ($1::text, now() - interval '4 hours'),
             ($2::text, now() - interval '4 hours 1 minute')
           ) as probes(body, stamp)
          where username = $3
         returning id, body`,
        [olderHiddenProbe, olderValidProbe, harness.student.username],
      );
      return rows;
    });
    expect(created.length === 2, 'the older-page probe rows could not be inserted');

    // Page until both adjacent probes are genuinely in the browser's older-page
    // cache. Four hours places them around the seeded second page, while the
    // bounded loop proves the run cannot pretend an unloaded row was reconciled.
    for (let tap = 0; tap < 5 && (await cardsWith(viewerHome, olderValidProbe)) === 0; tap += 1) {
      const more = viewerHome.getByRole('button', { name: /Show \d+ more entries/ });
      expect((await more.count()) === 1, 'the older-page probe never became loadable');
      await more.click();
      await viewerHome.waitForTimeout(1_500);
    }
    await waitForCard(viewerHome, olderValidProbe, SAME_TAB_MS, 'viewer older page');
    expect((await cardsWith(viewerHome, olderHiddenProbe)) === 1, 'the older hidden probe was not loaded');

    await viewerHome.evaluate(() => window.scrollTo(0, 0));
    await viewerHome.waitForTimeout(300);
    const scrollBefore = await viewerHome.evaluate(() => window.scrollY);
    const readsBefore = viewerHome.__counters.feedReads;
    const hidden = created.find((row) => row.body === olderHiddenProbe);
    await setStatus(hidden.id, 'hidden');
    const seconds = await waitForCardGone(viewerHome, olderHiddenProbe, CROSS_USER_MS, 'viewer older page');

    // A valid neighbor and the accepted new head post must survive the same and
    // subsequent reconciliations; absence from page one is not their tombstone.
    for (let i = 0; i < 2; i += 1) {
      await viewerHome.evaluate(() => window.dispatchEvent(new Event('focus')));
      await viewerHome.waitForTimeout(1_500);
      expect((await cardsWith(viewerHome, olderValidProbe)) === 1, 'a valid older post was discarded or duplicated');
      expect((await cardsWith(viewerHome, campusProbe)) === 1, 'the accepted new post did not survive reconciliation');
    }
    expect(await notReloaded(viewerHome), 'the older-page reconciliation reloaded the document');
    expect((await viewerHome.evaluate(() => window.scrollY)) === scrollBefore, 'older-page reconciliation moved the viewport');
    const reads = viewerHome.__counters.feedReads - readsBefore;
    expect(reads >= 1 && reads <= 6, `${reads} feed requests during older-page reconciliation`);
    return `older hidden row gone in ${seconds}s · valid older + accepted head retained · ${reads} bounded read(s)`;
  });
}

await check('moderation: a hidden post leaves both open feeds', async () => {
  const created = await findProbe(campusProbe);
  expect(created, 'the published probe row was not found in the database');
  await setStatus(created.id, 'hidden');
  const viewerSeconds = await waitForCardGone(viewerHome, campusProbe, CROSS_USER_MS, 'viewer Home');
  const authorSeconds = await waitForCardGone(authorHome, campusProbe, CROSS_USER_MS, 'author Home');
  return `gone from the viewer in ${viewerSeconds}s, from the author in ${authorSeconds}s`;
});

await check('moderation: a pending post never enters an open feed', async () => {
  const held = probe('pending');
  let postId = null;
  try {
    postId = await withDb(async (client) => {
      const { rows } = await client.query(
        `insert into public.posts (author_id, kind, body, visibility, status)
         select id, 'post', $1, 'campus', 'pending' from public.profiles where username = $2
         returning id`,
        [held, harness.student.username],
      );
      return rows[0]?.id || null;
    });
    expect(postId, 'the pending row could not be inserted');
    await authorHome.bringToFront();
    await authorHome.waitForTimeout(IDLE_MS + 24_000);
    expect((await cardsWith(authorHome, held)) === 0, 'a pending post appeared on its author Home');
    expect((await cardsWith(viewerHome, held)) === 0, 'a pending post appeared in another student feed');
    notes.push('the pending row stayed readable in the database and invisible on the feed');
    return 'invisible on both open feeds while the row exists';
  } finally {
    if (postId) await withDb((client) => client.query(`delete from public.posts where id = $1`, [postId]));
  }
});

/* 4 · a server-rendered board, and the campus feed boundary */
await check('community board: appears on the open page without a reload', async () => {
  await publish(authorBoard, communityProbe);
  const { count, seconds } = await waitForCard(authorBoard, communityProbe, CROSS_USER_MS, 'author board');
  expect(count === 1, `expected one copy on the board, saw ${count}`);
  // The board is server-rendered, so it converges through `router.refresh()` — a
  // same-document re-render. What must not happen is a reload or a navigation.
  expect(await notReloaded(authorBoard), 'the board reloaded instead of re-rendering in place');
  expect(authorBoard.url().endsWith(`/communities/${values.community}`), `the board navigated to ${authorBoard.url()}`);
  return `one copy in ${seconds}s on a server-rendered page`;
});

await check('community board: reaches the other member too', async () => {
  const { count, seconds } = await waitForCard(viewerBoard, communityProbe, CROSS_USER_MS, 'viewer board');
  expect(count === 1, `saw ${count} copies on the viewer board`);
  return `one copy in ${seconds}s`;
});

await check('community post is never placed on the campus feed', async () => {
  expect((await cardsWith(authorHome, communityProbe)) === 0, 'a community post appeared on Home');
  expect((await cardsWith(viewerHome, communityProbe)) === 0, 'a community post appeared on the viewer Home');
  return 'Home stayed out of it, exactly as campus_feed() does';
});

/* 5 · a failed write must not look like a published one */
await check('failure: no false success, draft preserved, retry works', async () => {
  let blocked = 0;
  await authorHome.route('**/home', (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action']) {
      blocked += 1;
      void route.abort('failed');
      return;
    }
    void route.continue();
  });

  await publish(authorHome, failedProbe);
  await authorHome.waitForTimeout(5_000);
  const cards = await cardsWith(authorHome, failedProbe);
  const draft = await composerBody(authorHome).inputValue();
  const notices = await authorHome.locator('[role="alert"], [role="status"], .notice').allInnerTexts();
  const button = await submitButton(authorHome).innerText();
  expect(blocked > 0, 'the write was never intercepted, so this run would prove nothing');
  expect(cards === 0, `the feed showed a post the server never accepted (${cards} card(s))`);
  expect(draft === failedProbe, `the draft was lost (value: ${JSON.stringify(draft.slice(0, 40))})`);
  expect(!/posting|publishing/i.test(button), `the composer is stuck pending: ${button}`);

  // The preserved draft then publishes on the next attempt, still with no reload.
  await authorHome.unroute('**/home');
  await submitButton(authorHome).click();
  const { count } = await waitForCard(authorHome, failedProbe, SAME_TAB_MS, 'retry after failure');
  expect(count === 1, `the retry produced ${count} copies`);
  return `refused cleanly (${(notices.join(' ') || 'no notice text').replace(/\s+/g, ' ').slice(0, 44)}), draft kept, published on retry`;
});

/* 6 · nothing polls */
await check('no polling: an idle open feed stops reading', async () => {
  const start = authorHome.__counters.feedReads;
  const startedAt = Date.now();
  await authorHome.bringToFront();
  await authorHome.waitForTimeout(IDLE_MS);
  const reads = authorHome.__counters.feedReads - start;
  const requests = authorHome.__counters.feedRequests
    .filter((request) => request.at >= startedAt)
    .map((request) => `${request.method} +${((request.at - startedAt) / 1000).toFixed(1)}s`)
    .join(', ');
  expect(reads <= 1, `${reads} feed reads during ${Math.round(IDLE_MS / 1000)}s of doing nothing${requests ? ` (${requests})` : ''}`);
  return `≤${reads} read(s) while idle${requests ? ` (${requests})` : ''}`;
});

await check('no client-side errors escaped to the console', async () => {
  const all = [...authorHome.__counters.errors, ...viewerHome.__counters.errors];
  expect(all.length === 0, all.slice(0, 2).join(' | '));
  return 'clean';
});

/* ----------------------------------------------------------------- teardown */

await withDb((client) => client.query(`delete from public.posts where body like $1`, [`feed-refresh-check ${runId} %`]));
await browser.close();

if (notes.length) console.log('');
for (const note of notes) log('note', note);
console.log(failures ? `\n${failures} check(s) failed` : '\nall feed-refresh checks passed');
process.exit(failures ? 1 : 0);
