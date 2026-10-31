#!/usr/bin/env node
/**
 * Production-build poll workflow acceptance check against the disposable real
 * PostgreSQL/RLS harness. Proves optimistic presentation, one in-flight write,
 * authoritative reconciliation, rollback, independent cards, and Home memory
 * synchronization across a client navigation — without a feed/page refresh.
 *
 *   node scripts/dev/poll-vote-check.mjs --base http://127.0.0.1:3100
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { launchBrowser } from './browser.mjs';
import { createSessionCookie } from './perf/session.mjs';
import { DATABASE_URL, root } from './perf/lib.mjs';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.PERF_APP_URL || 'http://127.0.0.1:3100' },
    output: { type: 'string', default: '' },
  },
});
const BASE = values.base;
const harness = JSON.parse(await readFile(path.join(root, 'node_modules/.cache/perf/harness.json'), 'utf8'));
const marker = `poll-acceptance-${Date.now().toString(36)}`;
const titles = [`${marker}-a`, `${marker}-b`];
const report = { label: 'poll workflow production-browser acceptance', base: BASE, marker, checks: [], errors: [] };
const postIds = [];
let browser;
let db;
let page;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}
async function check(label, run) {
  const detail = await run();
  report.checks.push({ label, detail: detail || 'passed' });
  console.log(`ok  ${label}${detail ? ` — ${detail}` : ''}`);
}
const card = (page, title) => page.locator('article').filter({ hasText: title }).first();
const totalVotes = async (page, title) => {
  const text = await card(page, title).innerText();
  return Number(text.match(/(\d+) votes?/)?.[1]);
}

try {
  db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const { rows: [author] } = await db.query("select id from public.profiles where username = 'aarav_p'");
  const { rows: [voter] } = await db.query(
    "select pp.profile_id as id, au.email from public.profile_private pp join auth.users au on au.id = pp.auth_user_id where au.email = 'perf.student7@pccoepune.org'",
  );
  expect(author && voter, 'fixture author/voter missing');
  report.voter = voter.email;

  for (const title of titles) {
    const { rows: [post] } = await db.query(
      "insert into public.posts(author_id, kind, title, body, visibility, status, created_at, updated_at) values($1, 'poll', $2, $2, 'campus', 'published', now(), now()) returning id",
      [author.id, title],
    );
    postIds.push(post.id);
    await db.query(
      "insert into public.poll_options(post_id, label, position) select $1, label, ordinality::int from unnest(array['Machine Learning', 'Cloud Computing']) with ordinality as o(label, ordinality)",
      [post.id],
    );
  }

  const session = await createSessionCookie(harness.stubUrl, voter.email);
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await context.addCookies([
    ...session.cookies.map(({ name, value }) => ({ name, value, url: BASE, sameSite: 'Lax' })),
    { name: 'campus_intro', value: '1', url: BASE },
  ]);
  await context.addInitScript(() => {
    window.__pollEvents = [];
    window.__pollCapture = false;
    try {
      new PerformanceObserver((list) => {
        if (!window.__pollCapture) return;
        for (const entry of list.getEntries()) {
          window.__pollEvents.push({
            name: entry.name,
            start: entry.startTime,
            duration: entry.duration,
            inputDelay: entry.processingStart - entry.startTime,
            processing: entry.processingEnd - entry.processingStart,
          });
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch {
      // Event Timing is diagnostic; functional assertions below remain authoritative.
    }
  });

  page = await context.newPage();
  const counters = { feedReads: 0, actions: 0, completedActions: 0 };
  page.on('request', (request) => {
    if (request.url().includes('/api/home/feed')) counters.feedReads += 1;
    if (request.method() === 'POST' && request.headers()['next-action']) counters.actions += 1;
  });
  page.on('requestfinished', (request) => {
    if (request.method() === 'POST' && request.headers()['next-action']) counters.completedActions += 1;
  });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('response', (response) => {
    if (!response.url().includes('/api/home/feed')) return;
    report.feedResponses ||= [];
    report.feedResponses.push({ status: response.status(), method: response.request().method() });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  let holdAction = false;
  let failAction = false;
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action']) {
      if (failAction) return route.abort('failed');
      if (holdAction) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return route.continue();
  });

  await page.goto(`${BASE}/home`, { waitUntil: 'load', timeout: 60_000 });
  await page.evaluate(() => { window.__documentMarker = 'poll-open'; });
  await page.locator('.home-stream').waitFor({ timeout: 20_000 });
  // The fixture's six future events and three pinned notices legitimately fill
  // nine head slots, so two new posts can straddle the first page boundary.
  if ((await card(page, titles[0]).count()) === 0 || (await card(page, titles[1]).count()) === 0) {
    await page.getByRole('button', { name: /Show \d+ more entries/ }).click();
  }
  await card(page, titles[0]).waitFor({ timeout: 20_000 });
  await card(page, titles[1]).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1_000);
  const initialFeedReads = counters.feedReads;

  await check('immediate selected style, option count/percentage and total before the action completes', async () => {
    const target = card(page, titles[0]);
    const option = target.getByRole('button', { name: /Cloud Computing/ });
    await option.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    holdAction = true;
    await page.evaluate((title) => {
      window.__pollClickStart = performance.now();
      window.__pollMutationAt = null;
      window.__pollCapture = true;
      const observer = new MutationObserver(() => {
        const article = [...document.querySelectorAll('article')].find((node) => node.textContent.includes(title));
        if (article?.querySelector('button[aria-pressed="true"]')?.textContent.includes('Cloud Computing')) {
          window.__pollMutationAt = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    }, titles[0]);
    const started = Date.now();
    await option.click();
    await page.waitForFunction((title) => {
      const article = [...document.querySelectorAll('article')].find((node) => node.textContent.includes(title));
      return article?.querySelector('button[aria-pressed="true"]')?.textContent.includes('Cloud Computing');
    }, titles[0], { timeout: 1_500 });
    report.automationVisibleLatencyMs = await page.evaluate(() => performance.now() - window.__pollClickStart);
    report.wallVisibleLatencyMs = Date.now() - started;
    report.stateMutationAt = await page.evaluate(() => window.__pollMutationAt);
    report.eventTiming = await page.evaluate(() => {
      window.__pollCapture = false;
      return window.__pollEvents;
    });
    const click = report.eventTiming.find((entry) => entry.name === 'click');
    report.clickDurationMs = click?.duration ?? null;
    report.visibleLatencyMs = click && report.stateMutationAt != null
      ? report.stateMutationAt - click.start
      : report.automationVisibleLatencyMs;
    const selected = target.locator('button[aria-pressed="true"]');
    expect(await selected.count() === 1, 'expected exactly one selected answer');
    expect((await selected.getAttribute('class')).includes('cp-poll-option--selected'), 'selected material class missing');
    expect((await selected.innerText()).includes('1 · 100%'), 'option count/percentage not optimistic');
    expect(await totalVotes(page, titles[0]) === 1, 'total was not optimistic');
    expect(counters.completedActions === 0, 'the held server action had already completed');
    return `${Math.round(report.visibleLatencyMs)} ms while the response was held`;
  });

  await check('rapid alternate click is protected and the other poll is independent', async () => {
    await card(page, titles[0]).getByRole('button', { name: /Machine Learning/ }).dispatchEvent('click');
    expect(counters.actions === 1, `expected one action, saw ${counters.actions}`);
    expect(await totalVotes(page, titles[1]) === 0, 'the second poll changed');
    expect(await card(page, titles[1]).locator('button[aria-pressed="true"]').count() === 0, 'the second poll gained a selection');
    return 'one action; second card unchanged';
  });

  await check('authoritative database counts reconcile without a feed read or reload', async () => {
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((node) => node.textContent.includes('Vote saved')), null, { timeout: 8_000 });
    holdAction = false;
    const { rows: votes } = await db.query('select option_id from public.poll_votes where post_id = $1 and user_id = $2', [postIds[0], voter.id]);
    const { rows: options } = await db.query('select id, vote_count from public.poll_options where post_id = $1 order by position', [postIds[0]]);
    expect(votes.length === 1, `database has ${votes.length} votes`);
    expect(options.find((option) => option.id === votes[0].option_id)?.vote_count === 1, 'trigger count did not reconcile');
    expect(await totalVotes(page, titles[0]) === 1, 'reconciled UI total differs');
    expect(counters.feedReads === initialFeedReads, `voting caused ${counters.feedReads - initialFeedReads} feed read(s)`);
    expect(await page.evaluate(() => window.__documentMarker) === 'poll-open', 'the document reloaded');
    return `one database vote; ${counters.feedReads} initial feed read only`;
  });

  await check('client navigation away/back retains the vote from Home memory', async () => {
    await page.locator('.bottom-dock a[href="/explore"]').click();
    await page.waitForURL('**/explore');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await card(page, titles[0]).waitFor({ timeout: 10_000 });
    expect(await totalVotes(page, titles[0]) === 1, 'navigation return lost the count');
    expect((await card(page, titles[0]).locator('button[aria-pressed="true"]').innerText()).includes('Cloud Computing'), 'navigation return lost the answer');
    expect(counters.feedReads === initialFeedReads, 'navigation return needed another feed read');
    expect(await page.evaluate(() => window.__documentMarker) === 'poll-open', 'navigation caused a full document reload');
    return 'answer and count intact; no feed read or reload';
  });

  await check('same-frame rapid clicks issue one failed write and roll back with an accessible error', async () => {
    failAction = true;
    const beforeActions = counters.actions;
    await card(page, titles[1]).evaluate((article) => {
      const options = article.querySelectorAll('.cp-poll-option');
      options[1].click();
      options[0].click();
    });
    await card(page, titles[1]).getByRole('alert').waitFor({ timeout: 8_000 });
    expect(counters.actions - beforeActions === 1, 'same-frame clicks produced duplicate writes');
    expect(await totalVotes(page, titles[1]) === 0, 'failed vote total did not roll back');
    expect(await card(page, titles[1]).locator('button[aria-pressed="true"]').count() === 0, 'failed selection did not roll back');
    const { rows: votes } = await db.query('select id from public.poll_votes where post_id = $1', [postIds[1]]);
    expect(votes.length === 0, 'failed write reached the database');
    failAction = false;
    return 'one refused action; original UI/database restored; role=alert';
  });

  expect(report.errors.length === 0, report.errors.join(' | '));
  report.counters = counters;
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error?.stack || String(error);
  if (page) {
    report.url = page.url();
    report.bodyExcerpt = (await page.locator('body').innerText().catch(() => '')).slice(0, 6_000);
  }
  console.error(`FAIL  ${error?.message || error}`);
} finally {
  if (browser) await browser.close();
  if (db) {
    if (postIds.length) await db.query('delete from public.posts where id = any($1::uuid[])', [postIds]);
    await db.end();
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) await writeFile(values.output, serialized);
  else console.log(serialized);
}

process.exit(report.ok ? 0 : 1);
