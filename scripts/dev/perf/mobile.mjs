#!/usr/bin/env node
/**
 * Real-browser mobile measurements for the production build.
 *
 * `measure.mjs` times the server and `assets.mjs` sizes the transfer; neither
 * can see what the browser actually paints. This tool drives the repo's own
 * Chromium bootstrap (`scripts/dev/browser.mjs`) against `next start` and
 * records the field-shaped numbers: FCP, LCP, CLS, DOM readiness, long tasks,
 * JS/CSS transfer, horizontal overflow and console errors — at real phone
 * viewports, with an optional throttled network + CPU profile.
 *
 * Usage (same conventions as measure.mjs / assets.mjs):
 *
 *   node scripts/dev/perf/mobile.mjs --label before
 *   node scripts/dev/perf/mobile.mjs --label after --runs 5 --throttle
 *   node scripts/dev/perf/mobile.mjs --label before --screenshots
 *
 * Options:
 *   --base <url>       Next.js server (default http://127.0.0.1:3100)
 *   --user student     Seeded account for authenticated routes
 *   --runs 3           Repetitions per (route, viewport, profile); median wins
 *   --routes a,b       Comma-separated route keys (default: the eight audited)
 *   --viewports all    `phone` (390×844 only), `phones`, or `all`
 *   --throttle         Also run a Slow-4G + 4× CPU profile
 *   --network-only     Skip the unthrottled pass
 *   --screenshots      Save PNGs to perf-results/screens/<label>/
 *   --json <file>      Where the raw result lands
 *
 * Honesty rules baked in:
 *   - every metric is read from the browser's own Performance APIs;
 *   - a metric the browser does not supply is reported as null, never guessed;
 *   - median of N runs is reported, and the spread is kept alongside it;
 *   - this is a lab simulation on one machine, not a field sample.
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSessionCookie } from './session.mjs';
import { root } from './lib.mjs';

const { values } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    base: { type: 'string', default: process.env.PERF_BASE || 'http://127.0.0.1:3100' },
    user: { type: 'string', default: 'student' },
    runs: { type: 'string', default: '3' },
    routes: { type: 'string' },
    viewports: { type: 'string', default: 'phone' },
    throttle: { type: 'boolean', default: false },
    'network-only': { type: 'boolean', default: false },
    screenshots: { type: 'boolean', default: false },
    'keep-intro': { type: 'boolean', default: false },
    json: { type: 'string' },
  },
});

/**
 * Viewports. Phone profiles are emulated as touch devices with a mobile UA so
 * the layout under test is the one a phone really gets (media queries, tap
 * targets, `dvh`).
 */
const VIEWPORTS = {
  small: { key: 'small', label: 'Small phone', width: 320, height: 700, dpr: 2, mobile: true },
  compact: { key: 'compact', label: 'Compact Android', width: 360, height: 800, dpr: 3, mobile: true },
  standard: { key: 'standard', label: 'Standard phone', width: 375, height: 812, dpr: 3, mobile: true },
  phone: { key: 'phone', label: 'Modern phone', width: 390, height: 844, dpr: 3, mobile: true },
  large: { key: 'large', label: 'Large phone', width: 430, height: 932, dpr: 3, mobile: true },
  wide: { key: 'wide', label: 'Wide Android', width: 412, height: 915, dpr: 3, mobile: true },
  tablet: { key: 'tablet', label: 'Tablet', width: 768, height: 1024, dpr: 2, mobile: true },
  desktop: { key: 'desktop', label: 'Desktop', width: 1440, height: 900, dpr: 1, mobile: false },
};

const VIEWPORT_SETS = {
  phone: ['phone'],
  phones: ['small', 'standard', 'phone', 'large'],
  // The production-mobile task's explicit phone matrix. Keep the historical
  // sets above intact so an older artifact can still be reproduced exactly.
  required: ['compact', 'standard', 'phone', 'wide'],
  all: ['small', 'compact', 'standard', 'phone', 'large', 'wide', 'tablet', 'desktop'],
};

/** Documented mobile profile: Lighthouse's "Slow 4G" numbers. */
const SLOW_4G = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};
const CPU_THROTTLE = 4;

const ROUTES = {
  root: { label: 'Root redirect', href: '/', public: true },
  home: { label: 'Home', href: '/home' },
  explore: { label: 'Explore', href: '/explore' },
  login: { label: 'Login', href: '/login', public: true },
  timetable: { label: 'Timetable index', href: '/timetable', public: true },
  division: { label: 'Division timetable', href: '/timetable/a', public: true },
  guide: { label: 'Guide', href: '/guide', public: true },
  notifications: { label: 'Notifications', href: '/notifications' },
  profile: { label: 'Profile', href: '/profile' },
  market: { label: 'Marketplace', href: '/market' },
  clubs: { label: 'Clubs', href: '/clubs' },
  gigs: { label: 'Gigs', href: '/gigs' },
};

// `--routes production` names the supplied field-baseline routes without
// changing the historical default matrix. Onboarding is deliberately absent:
// the seeded student has a complete profile and would be redirected to Home,
// which must not be mislabeled as an Onboarding measurement.
const PRODUCTION_ROUTES = ['root', 'home', 'division', 'explore', 'login', 'timetable', 'guide'];

const runs = Math.max(1, Number(values.runs) || 3);
const viewportKeys = VIEWPORT_SETS[values.viewports] || (VIEWPORTS[values.viewports] ? [values.viewports] : ['phone']);
const routeKeys = (values.routes === 'production'
  ? PRODUCTION_ROUTES
  : values.routes
    ? values.routes.split(',').map((key) => key.trim())
    : Object.keys(ROUTES).filter((key) => !PRODUCTION_ROUTES.includes(key) || ['home', 'explore', 'login'].includes(key))
).filter(Boolean);

const harness = JSON.parse(await readFile(path.join(root, 'node_modules/.cache/perf/harness.json'), 'utf8'));

/* -------------------------------------------------------------------------- */
/* Browser bootstrap                                                          */
/* -------------------------------------------------------------------------- */

let launchBrowser;
try {
  ({ launchBrowser } = await import(path.join(root, 'scripts/dev/browser.mjs')));
  await import('playwright-core');
} catch (error) {
  console.error(
    '\nA real browser is required for these measurements and the harness could not load one.\n' +
      `  ${error.message}\n\n` +
      '  The repository bootstraps Chromium from `@sparticuz/chromium` (dev-only, installed with\n' +
      '  `npm install --no-save @sparticuz/chromium`). Without it, FCP/LCP/CLS cannot be measured\n' +
      '  here — they are NOT estimated instead. Server-side numbers still come from\n' +
      '  `npm run perf:measure` and `node scripts/dev/perf/assets.mjs`.\n',
  );
  process.exit(2);
}

let browser;
try {
  browser = await launchBrowser();
} catch (error) {
  console.error(`\nChromium failed to launch: ${error.message}\n`);
  process.exit(2);
}

const studentSession = await createSessionCookie(
  harness.stubUrl,
  values.user === 'admin' ? harness.admin.email : harness.student.email,
);

/* -------------------------------------------------------------------------- */
/* One measured visit                                                         */
/* -------------------------------------------------------------------------- */

/** Runs in the page before any app code: installs the observers we read later. */
const INIT_SCRIPT = () => {
  window.__perf = { lcp: 0, lcpElement: null, cls: 0, longTasks: [], shifts: [] };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__perf.lcp = entry.startTime;
        const element = entry.element;
        window.__perf.lcpElement = element ? {
          tag: element.tagName,
          className: typeof element.className === 'string' ? element.className : '',
          text: (element.textContent || '').trim().slice(0, 120),
          url: entry.url || null,
        } : null;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* older engines: LCP stays 0 → reported as not measured */
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__perf.cls += entry.value;
          if (entry.value > 0) {
            window.__perf.shifts.push({
              value: Number(entry.value.toFixed(4)),
              at: Math.round(entry.startTime),
              sources: (entry.sources || []).map((src) => src.node?.className || src.node?.tagName || '?').slice(0, 3),
            });
          }
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    /* ignore */
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__perf.longTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* ignore */
  }
};

async function measureOnce(route, viewport, profile) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    userAgent: viewport.mobile
      ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      : undefined,
    reducedMotion: 'no-preference',
  });

  // A public route must really be signed out. Sending the student session to
  // /login redirects to /home and silently measures the wrong page.
  if (!route.public) {
    for (const cookie of studentSession.cookies) {
      await context.addCookies([
        { name: cookie.name, value: cookie.value, url: values.base, sameSite: 'Lax' },
      ]);
    }
  }

  const page = await context.newPage();
  const consoleErrors = [];
  const failedResponses = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error.message).slice(0, 200)}`));
  page.on('response', (response) => {
    if (response.status() < 400) return;
    failedResponses.push({
      status: response.status(),
      url: response.url(),
      resourceType: response.request().resourceType(),
    });
  });

  await page.addInitScript(INIT_SCRIPT);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  // Every visit is a cold first load: a warm HTTP cache would hide the very
  // bytes this tool exists to count.
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (profile.throttle) {
    await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });

  // Wire bytes per resource class. Chrome's Resource Timing reports zero sizes
  // for some Next.js chunks, so the CDP Network view is the reliable source.
  const transfer = { document: 0, script: 0, stylesheet: 0, font: 0, image: 0, other: 0 };
  const requests = new Map();
  cdp.on('Network.responseReceived', (event) => {
    requests.set(event.requestId, event.response);
  });
  cdp.on('Network.loadingFinished', (event) => {
    const response = requests.get(event.requestId);
    if (!response) return;
    const mime = response.mimeType || '';
    const kind = mime.includes('text/html')
      ? 'document'
      : mime.includes('javascript')
        ? 'script'
        : mime.includes('css')
          ? 'stylesheet'
          : mime.includes('font') || /\.(woff2?|ttf|otf)(\?|$)/.test(response.url)
            ? 'font'
            : mime.startsWith('image/')
              ? 'image'
              : 'other';
    transfer[kind] += event.encodedDataLength || 0;
  });

  const started = Date.now();
  await page.goto(`${values.base}${route.href}`, { waitUntil: 'load', timeout: 60_000 });

  // The cinematic intro is a first-visit overlay that deliberately covers the
  // page. Layout and content metrics are taken *after* it, so it is dismissed
  // the way a student would (`Skip intro`). Pass `--keep-intro` to measure the
  // overlay itself instead; either way the fact is recorded in the result.
  let introShown = false;
  try {
    const skip = page.getByRole('button', { name: 'Skip intro' });
    introShown = (await skip.count()) > 0;
    if (introShown && !values['keep-intro']) {
      await skip.first().click({ timeout: 5000 });
      await page.waitForTimeout(400);
    }
  } catch {
    /* no intro on this route, or it had already completed */
  }

  // Let the atmosphere settle and any post-hydration layout shifts land. A
  // fixed settle window is what every lab tool does; it is not a user metric.
  await page.waitForTimeout(profile.throttle ? 2500 : 1200);

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paint = performance.getEntriesByType('paint') || [];
    const fcpEntry = paint.find((entry) => entry.name === 'first-contentful-paint');

    const doc = document.documentElement;
    const overflow = doc.scrollWidth - window.innerWidth;

    // Where the composer and the first feed card actually land, in viewports.
    const composer = document.querySelector('.home-composer');
    const firstCard = document.querySelector('.home-stream > *');
    const vh = window.innerHeight;
    const box = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        top: Math.round(rect.top + window.scrollY),
        viewportsDown: Number(((rect.top + window.scrollY) / vh).toFixed(2)),
      };
    };

    return {
      fcp: fcpEntry ? Math.round(fcpEntry.startTime) : null,
      lcp: window.__perf?.lcp ? Math.round(window.__perf.lcp) : null,
      lcpElement: window.__perf?.lcpElement || null,
      cls: Number((window.__perf?.cls || 0).toFixed(4)),
      shifts: (window.__perf?.shifts || []).slice(0, 5),
      longTasks: window.__perf?.longTasks || [],
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      ttfb: Math.round(nav.responseStart || 0),
      redirectCount: typeof nav.redirectCount === 'number' ? nav.redirectCount : null,
      redirectMs: nav.redirectEnd && nav.redirectStart ? Math.round(nav.redirectEnd - nav.redirectStart) : 0,
      finalPath: location.pathname + location.search,
      introVisible: Boolean(document.querySelector('section[aria-label="Campus+ intro"]')),
      requestCount: performance.getEntriesByType('resource').length + 1,
      domNodes: document.getElementsByTagName('*').length,
      docHeight: Math.round(doc.scrollHeight),
      viewportHeight: vh,
      horizontalOverflow: overflow > 0 ? overflow : 0,
      composerPosition: box(composer),
      firstFeedCard: box(firstCard),
      stylesheets: [...document.styleSheets].map((sheet) => sheet.href).filter(Boolean).map((href) => href.split('/').pop()),
      bodyTextBytes: document.body?.innerText?.length || 0,
      headerHeight: Math.round(document.querySelector('.shell-header__bar')?.getBoundingClientRect().height || 0),
      dockHeight: Math.round(document.querySelector('.bottom-dock__bar')?.getBoundingClientRect().height || 0),
    };
  });

  if (values.screenshots) {
    const dir = path.join(root, 'perf-results/screens', values.label);
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: path.join(dir, `${route.key}-${viewport.key}${profile.throttle ? '-slow4g' : ''}.png`),
      fullPage: false,
    });
  }

  await context.close();

  return {
    ...metrics,
    introShown,
    transfer,
    transferJs: transfer.script,
    transferCss: transfer.stylesheet,
    transferDocument: transfer.document,
    transferFonts: transfer.font,
    transferTotal: Object.values(transfer).reduce((total, bytes) => total + bytes, 0),
    wallClockMs: Date.now() - started, 
    totalTaskTime: metrics.longTasks.reduce((total, task) => total + task.duration, 0),
    longTaskCount: metrics.longTasks.length,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 5),
    failedResponses: [...new Map(failedResponses.map((item) => [`${item.status}:${item.url}`, item])).values()].slice(0, 30),
  };
}

/* -------------------------------------------------------------------------- */
/* Matrix                                                                     */
/* -------------------------------------------------------------------------- */

const profiles = [];
if (!values['network-only']) profiles.push({ key: 'fast', throttle: false, cpu: 1, label: 'Unthrottled' });
if (values.throttle) profiles.push({ key: 'slow4g', throttle: true, cpu: CPU_THROTTLE, label: 'Slow 4G + 4× CPU' });

const median = (numbers) => {
  const sorted = [...numbers].filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const metricSpread = (samples, field) => {
  const numbers = samples.map((sample) => sample[field]).filter((value) => typeof value === 'number' && Number.isFinite(value));
  return numbers.length > 1 ? [Math.min(...numbers), Math.max(...numbers)] : null;
};

console.log(`\n\x1b[1mCampus+ mobile browser — ${values.label}\x1b[0m`);
console.log(`  ${values.base} · ${routeKeys.length} routes · ${viewportKeys.length} viewports · ${profiles.map((p) => p.label).join(', ')} · ${runs} runs\n`);

const results = [];
for (const profile of profiles) {
  for (const viewportKey of viewportKeys) {
    const viewport = VIEWPORTS[viewportKey];
    for (const routeKey of routeKeys) {
      const route = { ...ROUTES[routeKey], key: routeKey };
      if (!route.href) continue;
      const samples = [];
      for (let run = 0; run < runs; run += 1) {
        try {
          samples.push(await measureOnce(route, viewport, profile));
        } catch (error) {
          samples.push({ error: String(error.message || error).slice(0, 200) });
        }
      }
      const good = samples.filter((sample) => !sample.error);
      if (!good.length) {
        console.log(`  ! ${route.label} @ ${viewport.width}px failed: ${samples[0].error}`);
        continue;
      }
      const pick = (field) => median(good.map((sample) => sample[field]));
      results.push({
        route: route.label,
        routeKey,
        href: route.href,
        authentication: route.public ? 'signed-out' : values.user,
        viewport: viewport.key,
        width: viewport.width,
        height: viewport.height,
        profile: profile.key,
        runs: good.length,
        fcp: pick('fcp'),
        lcp: pick('lcp'),
        cls: pick('cls'),
        domContentLoaded: pick('domContentLoaded'),
        loadEvent: pick('loadEvent'),
        jsTransfer: pick('transferJs'),
        cssTransfer: pick('transferCss'),
        documentTransfer: pick('transferDocument'),
        fontTransfer: pick('transferFonts'),
        totalTransfer: pick('transferTotal'),
        requestCount: pick('requestCount'),
        longTaskCount: pick('longTaskCount'),
        totalTaskTime: pick('totalTaskTime'),
        horizontalOverflow: Math.max(...good.map((sample) => sample.horizontalOverflow || 0)),
        introShown: good.some((sample) => sample.introShown),
        introVisibleAtCapture: good.some((sample) => sample.introVisible),
        finalPaths: [...new Set(good.map((sample) => sample.finalPath).filter(Boolean))],
        domNodes: pick('domNodes'),
        docHeight: pick('docHeight'),
        headerHeight: pick('headerHeight'),
        dockHeight: pick('dockHeight'),
        composerPosition: good[0].composerPosition,
        firstFeedCard: good[0].firstFeedCard,
        stylesheets: good[0].stylesheets,
        shifts: good[0].shifts,
        lcpElement: good[0].lcpElement,
        consoleErrors: good[0].consoleErrors,
        failedResponses: [...new Map(
          good.flatMap((sample) => sample.failedResponses || []).map((item) => [`${item.status}:${item.url}`, item]),
        ).values()],
        // Every attempt is retained: medians hide both spread and the element
        // that actually painted, and an unavailable metric must stay null.
        attempts: samples,
        fcpSpread: metricSpread(good, 'fcp'),
        lcpSpread: metricSpread(good, 'lcp'),
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

const header = ['Route', 'Viewport', 'FCP', 'LCP', 'CLS', 'DCL', 'JS', 'CSS', 'Tasks', 'Overflow'];
const pad = (value, width) => String(value ?? '—').padEnd(width);
console.log(`\x1b[1m${pad(header[0], 16)}${pad(header[1], 16)}${pad(header[2], 7)}${pad(header[3], 7)}${pad(header[4], 7)}${pad(header[5], 7)}${pad(header[6], 10)}${pad(header[7], 10)}${pad(header[8], 7)}${header[9]}\x1b[0m`);
for (const row of results) {
  console.log(
    pad(row.route, 16) +
      pad(`${row.width}×${row.height}${row.profile === 'slow4g' ? ' ⏳' : ''}`, 16) +
      pad(row.fcp === null ? 'n/m' : `${row.fcp}ms`, 7) +
      pad(row.lcp === null ? 'n/m' : `${row.lcp}ms`, 7) +
      pad(row.cls?.toFixed(3) ?? 'n/m', 7) +
      pad(`${row.domContentLoaded}ms`, 7) +
      pad(`${(row.jsTransfer / 1024).toFixed(0)}kB`, 10) +
      pad(`${(row.cssTransfer / 1024).toFixed(0)}kB`, 10) +
      pad(row.longTaskCount, 7) +
      (row.horizontalOverflow ? `\x1b[31m+${row.horizontalOverflow}px\x1b[0m` : '0'),
  );
}

const overflowed = results.filter((row) => row.horizontalOverflow > 0);
const errored = results.filter((row) => row.consoleErrors?.length);
if (overflowed.length) {
  console.log(`\n\x1b[33mHorizontal overflow:\x1b[0m ${overflowed.map((row) => `${row.route}@${row.width}px (+${row.horizontalOverflow}px)`).join(', ')}`);
}
if (errored.length) {
  console.log(`\n\x1b[33mConsole errors:\x1b[0m`);
  for (const row of errored) console.log(`  ${row.route}@${row.width}px: ${row.consoleErrors.join(' | ')}`);
}
const failedResources = results.flatMap((row) =>
  (row.failedResponses || []).map((failure) => ({ ...failure, route: row.route, viewport: row.width })),
);
if (failedResources.length) {
  console.log(`\n\x1b[33mFailed response URLs:\x1b[0m`);
  for (const failure of failedResources) {
    console.log(`  ${failure.route}@${failure.viewport}px · ${failure.status} · ${failure.resourceType} · ${failure.url}`);
  }
}

const outFile = values.json || path.join(root, `perf-results/mobile-${values.label}.json`);
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(
  outFile,
  JSON.stringify(
    {
      label: values.label,
      base: values.base,
      measuredAt: new Date().toISOString(),
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      sourceState: execFileSync('git', ['describe', '--always', '--dirty'], { cwd: root, encoding: 'utf8' }).trim(),
      nodeVersion: process.version,
      runs,
      keepIntro: values['keep-intro'],
      routeSelection: values.routes || 'historical-default',
      profiles,
      viewports: viewportKeys.map((key) => VIEWPORTS[key]),
      results,
    },
    null,
    1,
  ),
);
console.log(`\nwrote ${path.relative(root, outFile)}\n`);

await browser.close();

// A page that overflows horizontally on a phone is a defect, not a datapoint.
process.exit(overflowed.length ? 1 : 0);
