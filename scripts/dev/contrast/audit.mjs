#!/usr/bin/env node
/**
 * Reproducible rendered readability audit against the existing disposable perf
 * backend. No production route, auth bypass or RLS change. Only the disposable
 * fixture DB is seeded; no content/admin forms are submitted. Normal chat read
 * receipts may update fixture messages as they do in the real application.
 *
 * 1. npm install --no-save embedded-postgres pg
 * 2. npm run perf:serve
 * 3. Configure next dev/build with the printed LOCAL fixture URL/key; port 3100.
 * 4. npx playwright install chromium
 * 5. npm run test:contrast [-- --quick]
 *
 * Screenshots/measurements stay in ignored node_modules/.cache/contrast.
 * Set CONTRAST_APP_URL or PLAYWRIGHT_CHROMIUM_EXECUTABLE when needed.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import pg from 'pg';
import { createSessionCookie } from '../perf/session.mjs';
import { seedContrastAccounts } from './seed.mjs';
import { measureViewport, verifyFocusPaint } from './rendered.mjs';

const { values } = parseArgs({ options: {
  quick: { type: 'boolean', default: false },
  suite: { type: 'string', default: 'all' },
  theme: { type: 'string', default: 'dark' },
  route: { type: 'string', multiple: true },
  role: { type: 'string', default: 'student' },
} });
if (!['all', 'routes', 'components', 'mobile', 'motion', 'intro'].includes(values.suite)) throw new Error('Invalid --suite');
if (values.theme !== 'dark') throw new Error('Invalid --theme: Campus+ is permanently dark');
if (!['student', 'moderator', 'admin', 'anonymous', 'onboarding', 'suspended'].includes(values.role)) throw new Error('Invalid --role');
if (values.route?.some((route) => !route.startsWith('/') || route.startsWith('//'))) throw new Error('--route must be an application-relative path');
const root = process.cwd();
const output = path.join(root, 'node_modules/.cache/contrast');
const base = process.env.CONTRAST_APP_URL || 'http://127.0.0.1:3100';
const harness = JSON.parse(await readFile(path.join(root, 'node_modules/.cache/perf/harness.json'), 'utf8'));
if (!['127.0.0.1', 'localhost'].includes(new URL(harness.stubUrl).hostname)) {
  throw new Error('This audit may only authenticate against the disposable LOCAL fixture harness.');
}
await mkdir(output, { recursive: true });

const launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
else {
  // Optional packaged Chromium works in network-restricted sandboxes. Normal
  // developer machines use `playwright install chromium`, without this package.
  try {
    const packaged = (await import('@sparticuz/chromium')).default;
    launch.executablePath = await packaged.executablePath();
    // Use Skia's CPU rasterizer in this GPU-less sandbox. SwiftShader's SVG
    // flare filters can starve screenshot commits; this still paints the real
    // CSS/SVG/canvas, rather than disabling any product effect or animation.
    launch.args = packaged.args.filter((arg) => ![
      '--single-process', '--disable-web-security', '--allow-running-insecure-content',
      '--in-process-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
    ].includes(arg));
    launch.args.push('--disable-gpu');
  } catch { /* Use Playwright's installed browser. */ }
}

const report = { startedAt: new Date().toISOString(), mode: values.quick ? 'quick' : 'full', suite: values.suite, theme: values.theme, filters: { routes: values.route || [], role: values.role }, axe: [], paint: [], states: [], screenshots: [], layouts: [], failures: [] };
const sessions = {};
for (const role of ['student', 'moderator', 'admin']) sessions[role] = await createSessionCookie(harness.stubUrl, harness[role].email);

const db = new pg.Client({ connectionString: harness.databaseUrl });
await db.connect();
const publicAccounts = await seedContrastAccounts(db, harness);
for (const [role, account] of Object.entries(publicAccounts)) sessions[role] = await createSessionCookie(harness.stubUrl, account.email);
const one = async (sql) => (await db.query(sql)).rows[0];
const ids = {};
for (const table of ['marketplace_listings', 'gigs', 'events', 'notices', 'official_resources', 'opportunities', 'projects']) {
  ids[table] = (await one(`select id from public.${table} where status::text in ('published', 'active') order by created_at desc limit 1`))?.id;
}
ids.poll = (await one("select id from public.posts where kind = 'poll' order by created_at desc limit 1"))?.id;
ids.post = (await one('select post_id as id from public.comments group by post_id order by count(*) desc limit 1'))?.id;
ids.club = (await one("select id from public.communities where kind = 'club' limit 1"))?.id;
ids.community = (await one("select slug from public.communities where kind = 'community' limit 1"))?.slug;
ids.listingOwned = (await db.query('select id from public.marketplace_listings where seller_id = $1 and status = $2 limit 1', [harness.student.profileId, 'active'])).rows[0]?.id;
const lostFound = (await db.query('select distinct on (kind) id, kind from public.lost_found order by kind, created_at desc')).rows;
await db.end();

const required = ['/home', '/explore', '/communities', '/chat', '/market', '/notifications', '/settings', '/profile'];
const extra = [
  '/campus', '/campus/noticeboard', '/campus/events', '/campus/utilities',
  '/campus/lost-found', '/campus/lost-found?kind=lost', '/campus/lost-found?kind=found',
  '/campus/lost-found/new', '/campus/lost-found/new?kind=lost', '/campus/lost-found/new?kind=found',
  '/campus/housing', '/campus/housing/new', '/campus/rides', '/campus/rides/new', '/campus/teams', '/campus/teams/new',
  '/explore/resources', '/explore/resources/new', '/explore/opportunities', '/explore/opportunities/new', '/explore/projects', '/explore/projects/new',
  '/market?tab=deals', '/market/new', '/market/new?type=gig',
  '/communities?tab=study_groups', '/communities/new', '/communities/new?kind=study_group',
  `/communities/${ids.community}`, `/user/${harness.student.username}`, `/chat/${harness.conversationId}`, `/post/${ids.post}`, `/post/${ids.poll}`,
  `/market/listing/${ids.marketplace_listings}`, `/campus/events/${ids.events}`, `/campus/noticeboard/${ids.notices}`,
  `/explore/resources/${ids.official_resources}`, `/explore/opportunities/${ids.opportunities}`, `/explore/projects/${ids.projects}`,
  '/gigs', '/gigs/new', '/clubs', '/clubs/new', `/gigs/${ids.gigs}`, `/clubs/${ids.club}`,
  ...lostFound.map((item) => `/campus/lost-found/${item.id}`),
  ...['profile', 'username', 'notifications', 'privacy', 'blocked', 'account'].map((tab) => `/settings?tab=${tab}`),
  '/explore?q=no_such_contrast_fixture_result', '/moderator', '/admin', '/post/00000000-0000-0000-0000-000000000001', '/a-missing-campus-page',
];
if (ids.listingOwned) extra.push(`/market/listing/${ids.listingOwned}/edit`);
const staff = [
  { role: 'moderator', routes: ['/moderator', ...['marketplace', 'random', 'content', 'audit'].map((tab) => `/moderator?tab=${tab}`)] },
  { role: 'admin', routes: ['/admin', ...['roles', 'permissions', 'reports', 'content', 'marketplace', 'events', 'settings', 'flags', 'audit', 'counts'].map((tab) => `/admin?tab=${tab}`)] },
];
const cases = values.route?.length ? values.route.map((route) => ({ route, role: values.role })) : [
  ...required.map((route) => ({ route, role: 'student' })),
  ...(values.quick ? [`/chat/${harness.conversationId}`, `/post/${ids.poll}`] : extra).map((route) => ({ route, role: 'student' })),
  ...staff.flatMap(({ role, routes }) => (values.quick ? routes.slice(0, 1) : routes).map((route) => ({ route, role }))),
  ...['/login', '/login?error=domain', '/login?notice=google'].map((route) => ({ route, role: 'anonymous' })),
  { route: '/rules', role: 'student' },
  { route: '/onboarding', role: 'onboarding' },
  { route: '/account-status', role: 'suspended' },
];

const bundled = await build({
  entryPoints: ['scripts/dev/contrast/fixtures.jsx'], bundle: true, write: false, format: 'iife', jsx: 'automatic',
  loader: { '.js': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': root, 'next/link': path.join(root, 'scripts/dev/contrast/next-stubs.jsx'), 'next/navigation': path.join(root, 'scripts/dev/contrast/next-stubs.jsx') },
});
const galleryScript = bundled.outputFiles[0].text;
const browser = await chromium.launch(launch);
const contexts = [];

async function contextFor(theme, role, mobile = false, motion = 'reduce') {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: motion, colorScheme: theme });
  contexts.push(context);
  context.setDefaultTimeout(20000);
  context.setDefaultNavigationTimeout(120000);
  await context.addCookies([
    { name: 'campus_intro', value: '1', url: base },
    ...(role === 'anonymous' ? [] : sessions[role].cookies.map((cookie) => ({ ...cookie, url: base }))),
  ]);
  // An unavailable GIF provider in the LOCAL harness is an honest error state.
  // Do not contact OAuth, GIPHY, or any production endpoint during this audit.
  await context.route(/https:\/\/(?![^/]+\.e2b\.app)/, (route) => route.abort());
  return context;
}

async function navigate(page, route) {
  const response = await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // Network-idle is unsuitable for realtime pages and inactive-account link
  // prefetch redirects. Wait for CSS/scripts/font readiness, not quiet sockets.
  await page.waitForLoadState('load', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  if (response.status() >= 500) throw new Error(`${route}: HTTP ${response.status()}`);
  await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
  // Hidden/lazy sidebar images on mobile never start a network request; decode
  // only visible images, with a bound so a broken provider cannot hang a run.
  await page.evaluate(async () => {
    await Promise.all([...document.images].filter((image) => {
      const r = image.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
    }).map((image) => Promise.race([
      image.decode().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ])));
  });
  if (['/onboarding', '/account-status'].includes(route) && new URL(page.url()).pathname !== route) throw new Error(`${route} did not render its real account-state gate`);
  if (route !== '/login' && !route.startsWith('/login?') && new URL(page.url()).pathname === '/login') throw new Error(`${route} redirected to login instead of rendering real content`);
}

async function axe(page, label, selector) {
  let builder = new AxeBuilder({ page }).withRules(['color-contrast']);
  if (selector) builder = builder.include(selector);
  console.log('  axe');
  const result = await builder.analyze();
  report.axe.push({ label, violations: result.violations, incomplete: result.incomplete });
  if (result.violations.length) report.failures.push({ label, type: 'axe', violations: result.violations });
}

async function paint(page, label, rootSelector) {
  console.log('  paint', label);
  const result = await measureViewport(page, { root: rootSelector || 'body' });
  if (!result.checked) throw new Error(`${label}: no rendered foreground was sampled`);
  result.theme = await page.evaluate(() => document.documentElement.dataset.theme || 'dark');
  report.paint.push({ label, ...result });
  if (result.failures.length) report.failures.push({ label, type: 'paint', failures: result.failures });
}

async function screenshot(page, label, fullPage = false, timeout = 20000) {
  const name = label.replace(/[^a-z\d-]+/gi, '-').toLowerCase() + '.png';
  await page.screenshot({ path: path.join(output, name), fullPage, caret: 'initial', scale: 'css', timeout });
  report.screenshots.push(name);
}

async function runPage(page, { theme, role, route, mobile = false }) {
  const label = `${theme}-${mobile ? 'mobile' : 'desktop'}-${role}-${route}`;
  console.log('Page', label);
  await navigate(page, route);
  await axe(page, label);
  await paint(page, `${label}-top`);
  if (!values.quick && !mobile) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > 1500) {
      await page.evaluate(() => scrollTo(0, Math.round(document.documentElement.scrollHeight / 2)));
      await paint(page, `${label}-middle`);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await paint(page, `${label}-bottom`);
      await page.evaluate(() => scrollTo(0, 0));
    }
  }
  if (values.route?.length || required.includes(route) || ['/login', '/login?error=domain', '/moderator', '/admin', '/onboarding', '/account-status'].includes(route)) await screenshot(page, label);
  // Real search rest/typed/focus state, not just a gallery markup imitation.
  if (['/home', '/explore'].includes(route)) {
    const field = page.locator('main .search-pill__input').first();
    await field.fill('Campus readability');
    await paint(page, `${label}-search-typed-focused`);
    report.states.push({ label: `${label}-search-focus`, ...await verifyFocusPaint(page, field, field.locator('..')) });
    await field.fill('');
    await paint(page, `${label}-search-placeholder-focused`);
  }
  if (route === '/home') {
    const nav = mobile ? '.tab-item' : 'aside .nav-item';
    for (const selector of [`${nav}[aria-current="page"]`, `${nav}[href="/explore"]`]) {
      const item = page.locator(selector).first();
      if (!await item.count()) continue;
      await item.hover(); await paint(page, `${label}-nav-hover-${selector}`);
      report.states.push({ label: `${label}-nav-focus-${selector}`, ...await verifyFocusPaint(page, item) });
      await page.mouse.down(); await paint(page, `${label}-nav-pressed-${selector}`);
      await page.mouse.move(0, 0); await page.mouse.up();
    }
  }
}

async function gallery(page, theme) {
  await navigate(page, '/home');
  await page.evaluate(() => { document.body.replaceChildren(); const root = document.createElement('div'); root.id = 'cp-contrast-root'; document.body.append(root); });
  await page.addScriptTag({ content: galleryScript });
  await page.locator('#cp-contrast-fixture').waitFor();
  await axe(page, `${theme}-gallery`);
  for (const section of await page.locator('[data-audit-section]').all()) {
    await section.scrollIntoViewIfNeeded();
    const id = await section.getAttribute('id');
    await paint(page, `${theme}-gallery-${id}`);
  }
  for (const name of ['primary', 'accent', 'warm', 'sheen', 'secondary', 'quiet', 'subtle', 'danger', 'delete', 'keycap', 'keycap-accent', 'icon-button', 'chip']) {
    const control = page.locator(`[data-audit="${name}"]`);
    await control.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0); await control.evaluate((element) => element.blur());
    await paint(page, `${theme}-${name}-rest`);
    await control.hover();
    await paint(page, `${theme}-${name}-hover`);
    report.states.push({ label: `${theme}-${name}-focus`, ...await verifyFocusPaint(page, control) });
    await paint(page, `${theme}-${name}-focus`);
    await page.mouse.down();
    await paint(page, `${theme}-${name}-pressed`);
    await page.mouse.up();
    await control.evaluate((element) => { element.disabled = true; element.blur(); });
    await paint(page, `${theme}-${name}-disabled`);
    await control.evaluate((element) => { element.disabled = false; });
  }
  for (const name of ['input', 'textarea', 'select']) {
    const control = page.locator(`[data-audit="${name}"]`);
    await control.scrollIntoViewIfNeeded();
    report.states.push({ label: `${theme}-${name}-focus`, ...await verifyFocusPaint(page, control) });
    if (name !== 'select') { await control.fill('Readable typed content'); await paint(page, `${theme}-${name}-typed`); await control.fill(''); }
    await paint(page, `${theme}-${name}-placeholder-or-selected`);
  }
  for (const name of ['checkbox', 'switch']) {
    const control = page.locator(`[data-audit="${name}"]`);
    await control.scrollIntoViewIfNeeded();
    const visible = control.locator('..').locator(name === 'checkbox' ? '.check-box' : '.switch-track');
    report.states.push({ label: `${theme}-${name}-focus`, ...await verifyFocusPaint(page, control, visible) });
    await control.locator('..').click();
    if (!await control.isChecked()) throw new Error(`${name} label did not check the native input`);
    await paint(page, `${theme}-${name}-checked`);
    await control.press('Space');
    if (await control.isChecked()) throw new Error(`${name} keyboard toggle did not uncheck the native input`);
    await paint(page, `${theme}-${name}-unchecked`);
  }
  await page.locator('#overlays button[aria-haspopup="menu"]').click();
  await axe(page, `${theme}-dropdown`, '[role="menu"]');
  await paint(page, `${theme}-dropdown`, '[role="menu"]');
  await page.keyboard.press('Escape');
  await page.locator('[data-audit="open-modal"]').click();
  await axe(page, `${theme}-modal`, '[role="dialog"]');
  await paint(page, `${theme}-modal`, '[role="dialog"]');
  await screenshot(page, `${theme}-dialog`);
  await page.keyboard.press('Escape');
  for (const tone of ['neutral', 'success', 'danger']) {
    await page.locator(`[data-audit="toast-${tone}"]`).click();
    await page.locator('.toast').waitFor({ state: 'visible' });
    await paint(page, `${theme}-toast-${tone}`, '.toast');
  }
  await page.locator('[data-audit="clear-toast"]').click();
  await page.locator('#wheel').scrollIntoViewIfNeeded();
  for (const value of ['feed', 'discussions', 'polls']) {
    await page.locator(`label[for="audit-wheel-${value}"]`).click();
    const radio = page.locator(`#audit-wheel-${value}`);
    report.states.push({ label: `${theme}-wheel-${value}-focus`, ...await verifyFocusPaint(page, radio, page.locator(`label[for="audit-wheel-${value}"] .wheel__copy`)) });
    await paint(page, `${theme}-gallery-wheel-${value}`);
  }
  await screenshot(page, `${theme}-component-gallery`);
  await page.locator('#buttons').scrollIntoViewIfNeeded();
  await screenshot(page, `${theme}-component-buttons`);
  await page.locator('#glass').scrollIntoViewIfNeeded();
  await screenshot(page, `${theme}-component-glass`);
}

try {
  const themes = [values.theme];
  for (const theme of themes) {
    if (['all', 'routes'].includes(values.suite)) {
      for (const role of ['student', 'moderator', 'admin', 'anonymous', 'onboarding', 'suspended']) {
        const context = await contextFor(theme, role);
        const page = await context.newPage();
        for (const item of cases.filter((entry) => entry.role === role)) await runPage(page, { ...item, theme });
        await context.close();
      }
    }
    if (['all', 'components'].includes(values.suite)) {
      const context = await contextFor(theme, 'student');
      await gallery(await context.newPage(), theme);
      await context.close();
    }
    if (['all', 'mobile'].includes(values.suite)) {
      const context = await contextFor(theme, 'student', true);
      const mobile = await context.newPage();
      for (const route of ['/home', '/explore', '/chat', '/market', '/notifications', '/settings', '/profile']) await runPage(mobile, { theme, role: 'student', route, mobile: true });
      await mobile.setViewportSize({ width: 320, height: 844 });
      await runPage(mobile, { theme, role: 'student-320px', route: '/settings', mobile: true });
      await context.close();
      const loginContext = await contextFor(theme, 'anonymous', true);
      await runPage(await loginContext.newPage(), { theme, role: 'anonymous', route: '/login?error=domain', mobile: true });
      await loginContext.close();
    }
    if (['all', 'intro'].includes(values.suite)) {
      for (const mobile of [false, true]) {
        const context = await contextFor(theme, 'student', mobile, 'no-preference');
        // Exercise the actual Home launch gate, not an invented replacement.
        await context.clearCookies({ name: 'campus_intro' });
        const page = await context.newPage();
        await navigate(page, '/home');
        // The launch overlay is the current implementation: a full-screen stage
        // whose SVG wordmark is drawn with a stroke animation. Wait until it has
        // actually started playing rather than for a DOM-string wordmark that no
        // longer exists (the stale selector this probe used to query).
        const INTRO = 'section[aria-label="Campus+ intro"]';
        await page.waitForFunction(
          (selector) => {
            const stage = document.querySelector(selector);
            return Boolean(stage) && stage.dataset.phase !== 'waiting';
          },
          INTRO,
          { timeout: 20000 },
        );
        const label = `${theme}-${mobile ? 'portrait' : 'desktop'}-intro`;
        const mark = await page.locator(`${INTRO} svg`).boundingBox();
        const viewport = page.viewportSize();
        if (!mark || mark.x < -1 || mark.x + mark.width > viewport.width + 1 || mark.y < -1 || mark.y + mark.height > viewport.height + 1) throw new Error('Intro wordmark is cropped');
        report.layouts.push({ label, markFits: true, viewport });
        await screenshot(page, label, false, 60000);
        await page.keyboard.press('Escape');
        await page.locator(INTRO).waitFor({ state: 'detached', timeout: 15000 });
        // This is the settled post-handover check, not a mid-fade sample. Real
        // stats can mount during the intro and run their existing 120 ms +
        // 700 ms threshold arrival. Let that finite animation finish instead
        // of attributing its transient opacity to the static colour tokens.
        // The motion suite below still audits the animation at multiple phases.
        await page.evaluate(async () => {
          const stats = document.querySelector('.home-pulse__stats');
          if (!stats) return;
          await Promise.all(stats.getAnimations().map((animation) => animation.finished.catch(() => {})));
        });
        await paint(page, `${label}-handover`);
        await context.close();
      }
    }
    if (['all', 'motion'].includes(values.suite)) {
      // Animation-on paint checks at several phases, not just still frames.
      const context = await contextFor(theme, 'student', false, 'no-preference');
      const moving = await context.newPage();
      await navigate(moving, '/home');
      await moving.getByRole('link', { name: 'Explore campus', exact: true }).hover();
      for (const phase of [0, 650, 1350]) { await moving.waitForTimeout(phase); await paint(moving, `${theme}-home-animated-${phase}`); }
      await screenshot(moving, `${theme}-home-motion`);
      await context.close();
    }
  }
} catch (error) {
  report.failures.push({ type: 'harness-or-state', message: error.message, stack: error.stack });
  console.error(error);
} finally {
  report.finishedAt = new Date().toISOString();
  const paints = report.paint.flatMap((entry) => entry.samples);
  report.summary = {
    pageAudits: report.axe.length,
    paintAudits: report.paint.length,
    foregroundSamples: paints.length,
    textSamples: paints.filter((entry) => ['text', 'placeholder', 'input'].includes(entry.kind)).length,
    iconSamples: paints.filter((entry) => entry.kind === 'icon').length,
    focusStates: report.states.length,
    layoutChecks: report.layouts.length,
    failures: report.failures.length,
  };
  await writeFile(path.join(output, `report-${values.suite}-${values.theme}.json`), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(output, `summary-${values.suite}-${values.theme}.json`), JSON.stringify({ ...report.summary, failures: report.failures }, null, 2));
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Evidence: ${output}`);
}
if (report.failures.length) process.exitCode = 1;
