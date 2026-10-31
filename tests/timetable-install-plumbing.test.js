import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TIMETABLE_SCOPE,
  TIMETABLE_SHELL_PATH,
  TIMETABLE_SW_PATH,
  TIMETABLE_WIDE_SCOPE,
} from '@/lib/timetable/batch';
import {
  cacheCurrentDocument,
  collectShellAssetUrls,
  detectPlatform,
  dropOfflineCaches,
  installOfferDecision,
  installPathFor,
  isMobileFormFactor,
  isStandalone,
  parkInstallPrompt,
  TIMETABLE_INSTALL_OFFER_COOLDOWN_MS,
  TIMETABLE_INSTALL_REOFFER_MS,
  offlineStateCopy,
  precacheOfflineShell,
  registerTimetableWorker,
  sendPrecacheMessage,
  showInstallPrompt,
  skipWaiting,
  unregisterOwnWorker,
  watchInstallPrompt,
  watchInstalled,
  workerAllowed,
} from '@/lib/timetable/offline-install';
import {
  offerAction,
  offerSummary,
  primaryAction,
  stepsFor,
} from '@/components/timetable/TimetableOfflineUi';

/**
 * Platform plumbing: what the browser is, what it allows, and what the button
 * is therefore allowed to promise.
 *
 * This is where an offline feature most often starts lying — a button that
 * claims "Added to Home Screen" because a click happened, a worker registered
 * in `next dev` that pins a stale bundle, a reload that changes nothing. The
 * tests below keep the claims honest, including the two ways a registration can
 * be scoped, and the rule that the next page must never unregister a service
 * worker that is not its own.
 */

const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DESKTOP_FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';

function fakeTarget({ register, registration } = {}) {
  const listeners = new Map();
  return {
    listeners,
    serviceWorker: {
      addEventListener: (type, handler) => listeners.set(type, handler),
      removeEventListener: (type) => listeners.delete(type),
      register,
      getRegistration: async () => registration ?? null,
    },
  };
}

beforeEach(() => {
  const listeners = new Map();
  vi.stubGlobal('navigator', {
    serviceWorker: {
      addEventListener: (type, handler) => listeners.set(type, handler),
      removeEventListener: (type) => listeners.delete(type),
      getRegistration: async () => null,
    },
    storage: { persisted: async () => true, persist: async () => true, estimate: async () => ({ usage: 1, quota: 2 }) },
    userAgent: DESKTOP_CHROME,
    maxTouchPoints: 0,
  });
  navigator.serviceWorker._listeners = listeners;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the browser is', () => {
  it('separates iOS, Android, Chromium, Firefox and desktop Safari', () => {
    expect(detectPlatform(IOS_SAFARI, { maxTouchPoints: 5 }).kind).toBe('ios');
    expect(detectPlatform(ANDROID_CHROME, { maxTouchPoints: 10 }).kind).toBe('android');
    expect(detectPlatform(DESKTOP_CHROME, { maxTouchPoints: 0 }).kind).toBe('chromium-desktop');
    expect(detectPlatform(DESKTOP_FIREFOX, { maxTouchPoints: 0 }).kind).toBe('firefox');
    expect(detectPlatform(MAC_SAFARI, { maxTouchPoints: 0 }).kind).toBe('safari-desktop');
    expect(detectPlatform('', {}).kind).toBe('unknown');
    expect(detectPlatform(undefined, undefined).kind).toBe('unknown');
  });

  it('recognises an iPad reporting itself as a Mac', () => {
    // iPadOS "desktop site" mode is the classic false negative: the only clue is
    // that a Mac does not have five touch points.
    expect(detectPlatform(IPAD_AS_MAC, { maxTouchPoints: 5 }).kind).toBe('ios');
    expect(detectPlatform(IPAD_AS_MAC, { maxTouchPoints: 0 }).kind).toBe('safari-desktop');
  });

  it('labels the platform the way the sheet will say it out loud', () => {
    // On mobile the label names the platform, because that is what determines the
    // gesture: every iOS browser is WebKit with the same Share sheet, and the Android
    // menu item is the system's. Saying "Safari" there would be both wrong (Firefox on
    // Android reads it as an accusation) and an instruction the user cannot follow.
    expect(detectPlatform(IOS_SAFARI, { maxTouchPoints: 5 }).label).toBe('iPhone or iPad');
    expect(detectPlatform(ANDROID_CHROME, { maxTouchPoints: 10 }).label).toBe('Android');
    // Desktop is the opposite case: the browser picks the wording, and the detection
    // is specific enough to be true there.
    expect(detectPlatform(MAC_SAFARI, { maxTouchPoints: 0 }).label).toBe('Safari on desktop');
    expect(detectPlatform(DESKTOP_CHROME, { maxTouchPoints: 0 }).label).toBe('Chrome on desktop');
  });

  it('maps platform plus prompt support onto the three install paths', () => {
    expect(installPathFor({ kind: 'chromium-desktop' }, { hasBeforeInstallPrompt: true })).toBe('native');
    expect(installPathFor({ kind: 'android' }, { hasBeforeInstallPrompt: true })).toBe('native');
    // Chromium without the event (too few visits, or a browser that removed it):
    // the guide, not a fake dialog.
    expect(installPathFor({ kind: 'chromium-desktop' }, { hasBeforeInstallPrompt: false })).toBe('manual');
    expect(installPathFor({ kind: 'firefox' })).toBe('manual');
    expect(installPathFor({ kind: 'safari-desktop' })).toBe('manual');
    expect(installPathFor({ kind: 'unknown' })).toBe('manual');
    // iOS never has the event, and never gets a "native" promise either.
    expect(installPathFor({ kind: 'ios' }, { hasBeforeInstallPrompt: true })).toBe('ios');
    expect(installPathFor(undefined)).toBe('manual');
  });

  it('treats "installed" as something only the platform can say', () => {
    expect(isStandalone(() => ({ matches: false }), { standalone: true })).toBe(true);
    expect(isStandalone((query) => ({ matches: query === '(display-mode: standalone)' }))).toBe(true);
    expect(isStandalone((query) => ({ matches: query === '(display-mode: fullscreen)' }))).toBe(true);
    expect(isStandalone(() => ({ matches: false }), {})).toBe(false);
    expect(isStandalone(null, {})).toBe(false);
    expect(
      isStandalone(() => {
        throw new Error('no matchMedia');
      }),
    ).toBe(false);
  });
});

describe('beforeinstallprompt', () => {
  it('captures the event and prevents the browser infobar', () => {
    const events = new Map();
    const target = {
      addEventListener: (type, handler) => events.set(type, handler),
      removeEventListener: (type) => events.delete(type),
    };
    let captured = null;
    const stop = watchInstallPrompt(target, (event) => {
      captured = event;
    });
    expect(events.has('beforeinstallprompt')).toBe(true);

    let prevented = false;
    events.get('beforeinstallprompt')({ preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true); // no unprompted popup, ever
    expect(captured).toBeTruthy();

    stop();
    expect(events.has('beforeinstallprompt')).toBe(false);
  });

  it('adopts an event that arrived before the component was listening', () => {
    // The race this exists for: Chrome fires the event whenever it likes, and the
    // provider's listener only exists after hydration. The module-scope capture
    // parks it on `window`; a listener attached later must take it from there.
    const events = new Map();
    const early = { preventDefault: () => {}, prompt: () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
    const target = {
      __cpInstallPrompt: early,
      addEventListener: (type, handler) => events.set(type, handler),
      removeEventListener: (type) => events.delete(type),
    };
    const seen = [];
    watchInstallPrompt(target, (event) => seen.push(event));
    expect(seen).toEqual([early]);
    expect(target.__cpInstallPrompt).toBeUndefined();
    // And a second, later event is still delivered — once, not twice.
    events.get('beforeinstallprompt')({ preventDefault: () => {} });
    expect(seen).toHaveLength(2);
  });

  it('the module-scope capture parks the event instead of answering it', () => {
    const events = new Map();
    const target = {
      addEventListener: (type, handler) => events.set(type, handler),
      removeEventListener: (type) => events.delete(type),
    };
    const stop = parkInstallPrompt(target);
    let prevented = false;
    const event = { preventDefault: () => (prevented = true) };
    events.get('beforeinstallprompt')(event);
    // Suppressed (one install UI at a time is the strategy) and parked for whoever
    // mounts next. It is *not* shown here: nothing may call prompt() from a listener.
    expect(prevented).toBe(true);
    expect(target.__cpInstallPrompt).toBe(event);
    expect(target.__cpInstallPromptSeen).toBe(1);
    expect(event.prompt).toBeUndefined();
    stop();
    expect(events.has('beforeinstallprompt')).toBe(false);
    expect(typeof parkInstallPrompt(undefined)).toBe('function');
  });

  it('tolerates a browser without the event at all', () => {
    expect(typeof watchInstallPrompt(undefined, () => {})).toBe('function');
    expect(typeof watchInstalled(null, () => {})).toBe('function');
  });

  it('reports accepted, dismissed and unsupported separately', async () => {
    let shown = 0;
    const accepted = { prompt: () => (shown += 1), userChoice: Promise.resolve({ outcome: 'accepted' }) };
    expect(await showInstallPrompt(accepted)).toEqual({ outcome: 'accepted' });
    expect(shown).toBe(1);

    const dismissed = { prompt: () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
    expect(await showInstallPrompt(dismissed)).toEqual({ outcome: 'dismissed' });

    // A browser that has the event but fails to resolve the choice is "unsupported",
    // never a silent failure.
    const broken = { prompt: () => {}, userChoice: Promise.reject(new Error('nope')) };
    expect(await showInstallPrompt(broken)).toEqual({ outcome: 'unsupported' });

    expect(await showInstallPrompt(undefined)).toEqual({ outcome: 'unsupported' });
    expect(await showInstallPrompt({ prompt: () => { throw new Error('gone'); } })).toEqual({ outcome: 'unsupported' });
  });

  it('listens for appinstalled, the only reliable evidence of a home-screen icon', () => {
    const events = new Map();
    let fired = 0;
    const stop = watchInstalled({ addEventListener: (t, h) => events.set(t, h), removeEventListener: (t) => events.delete(t) }, () => (fired += 1));
    events.get('appinstalled')();
    expect(fired).toBe(1);
    stop();
    expect(events.has('appinstalled')).toBe(false);
  });
});

describe('the service worker', () => {
  it('is registered only in a production build', () => {
    expect(workerAllowed(true)).toBe(true);
    expect(workerAllowed(false)).toBe(false);
    expect(workerAllowed(undefined)).toBe(false);
    expect(workerAllowed('production')).toBe(false); // only the boolean counts
  });

  it('is registered at the timetable path, and a wide scope is a bonus', async () => {
    const attempts = [];
    const target = fakeTarget({
      register: async (path, options) => {
        attempts.push({ path, scope: options.scope });
        return { scope: options.scope, installing: null, active: {}, waiting: null };
      },
    });
    const result = await registerTimetableWorker(target);
    expect(result.state).toBe('registered');
    expect(attempts[0]).toEqual({ path: TIMETABLE_SW_PATH, scope: TIMETABLE_WIDE_SCOPE });
    expect(result.wide).toBe(true);
    expect(result.scope).toBe(TIMETABLE_WIDE_SCOPE);
    // The wide scope is the goal (it lets the worker answer a reload of
    // `/timetable/o`, which lives outside `/timetable/` only as a path
    // convention); the narrow scope is the fallback for a browser that will not
    // accept it. Both are inside Campus+ and neither covers the whole site.
    expect(TIMETABLE_WIDE_SCOPE).toBe('/');
    expect(TIMETABLE_SCOPE).toBe('/timetable/');
    expect(TIMETABLE_SW_PATH).toBe('/timetable/sw.js');
    expect(TIMETABLE_SHELL_PATH).toBe('/timetable/offline');
  });

  it('falls back to the narrow scope when the origin refuses a wide one', async () => {
    const attempts = [];
    const target = fakeTarget({
      register: async (path, options) => {
        attempts.push(options.scope);
        if (options.scope === TIMETABLE_WIDE_SCOPE) throw new TypeError('Scope not allowed');
        return { scope: options.scope, installing: null, active: {} };
      },
    });
    const result = await registerTimetableWorker(target);
    expect(attempts).toEqual([TIMETABLE_WIDE_SCOPE, TIMETABLE_SCOPE]);
    expect(result.state).toBe('registered');
    expect(result.wide).toBe(false);
  });

  it('reports no support and a failure instead of throwing', async () => {
    expect(await registerTimetableWorker({})).toEqual({ state: 'unsupported', scope: null });
    expect(await registerTimetableWorker(null)).toEqual({ state: 'unsupported', scope: null });
    const failing = fakeTarget({
      register: async () => {
        throw new Error('denied');
      },
    });
    const result = await registerTimetableWorker(failing);
    expect(result.state).toBe('error');
    expect(result.error).toContain('Error');
  });

  it('waits for the worker to settle before the page starts messaging it', async () => {
    let settled = false;
    const installing = { addEventListener: (type, handler) => setTimeout(() => { settled = true; handler(); }, 5) };
    const target = fakeTarget({
      register: async (path, options) => ({ scope: options.scope, installing, active: null, waiting: null }),
    });
    const result = await registerTimetableWorker(target);
    expect(settled).toBe(true);
    expect(result.state).toBe('registered');
  });

  it('never unregisters a worker that is not this feature’s own', async () => {
    let unregistered = 0;
    const other = {
      active: { scriptURL: 'https://pccoe.in/sw.js' },
      unregister: async () => (unregistered += 1),
    };
    const mine = {
      active: { scriptURL: 'https://pccoe.in/timetable/sw.js' },
      unregister: async () => (unregistered += 1),
    };
    expect(await unregisterOwnWorker(fakeTarget({ registration: other }))).toEqual({ ok: true, unregistered: false });
    expect(unregistered).toBe(0);
    expect(await unregisterOwnWorker(fakeTarget({ registration: mine }))).toEqual({ ok: true, unregistered: true });
    expect(unregistered).toBe(1);
    // Nothing to look at is not a failure — and nothing was removed either.
    expect(await unregisterOwnWorker(null)).toEqual({ ok: true, unregistered: false });
  });

  it('only claims an update when there is a waiting worker to claim it', () => {
    let posted = null;
    expect(skipWaiting({ waiting: { postMessage: (message) => (posted = message) } })).toBe(true);
    expect(posted).toEqual({ type: 'cp:skip-waiting' });
    // No waiting worker → false, so the page does not reload for nothing.
    expect(skipWaiting({ active: {}, waiting: null })).toBe(false);
    expect(skipWaiting(null)).toBe(false);
    expect(
      skipWaiting({
        waiting: {
          postMessage: () => {
            throw new Error('context destroyed');
          },
        },
      }),
    ).toBe(false);
  });
});

describe('worker messages', () => {
  const registrationWith = (worker) => ({ active: worker, waiting: null, installing: null });

  it('resolve to unsupported when there is nobody to ask', async () => {
    expect(await cacheCurrentDocument(null)).toMatchObject({ state: 'unsupported', cached: false });
    expect(await precacheOfflineShell(undefined)).toMatchObject({ state: 'unsupported' });
    expect(await sendPrecacheMessage(null, [])).toMatchObject({ state: 'unsupported', requested: 0 });
    expect(await dropOfflineCaches({})).toMatchObject({ state: 'unsupported', deleted: 0 });
  });

  it('wait for the reply and report what the worker said', async () => {
    const reply = (type, payload) =>
      registrationWith({
        postMessage: () => {
          setTimeout(() => navigator.serviceWorker._listeners.get('message')({ data: { type, ...payload } }), 1);
        },
      });

    await expect(cacheCurrentDocument(reply('cp:cache-document-done', { cached: true, stored: 21, failed: 0 }))).resolves.toEqual({
      state: 'done',
      cached: true,
      stored: 21,
      failed: 0,
    });
    await expect(precacheOfflineShell(reply('cp:precache-shell-done', { stored: 19, failed: 0 }))).resolves.toMatchObject({
      state: 'done',
      stored: 19,
      failed: 0,
    });
    await expect(sendPrecacheMessage(reply('cp:precache-assets-done', { stored: 4, requested: 6 }), ['a', 'b', 'c', 'd', 'e', 'f'])).resolves.toEqual({
      state: 'done',
      stored: 4,
      requested: 6,
    });
    await expect(dropOfflineCaches(reply('cp:cleared', { deleted: 3 }))).resolves.toEqual({ state: 'done', deleted: 3 });
  });

  it('give up on a timeout rather than hanging the save, and stop listening', async () => {
    const silent = registrationWith({ postMessage: () => {} });
    const started = Date.now();
    const result = await cacheCurrentDocument(silent, { timeoutMs: 25 });
    expect(result).toMatchObject({ state: 'timeout', cached: false });
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    // The listener from the finished call is gone; only leaked handlers would
    // make every later message arrive twice.
    expect(navigator.serviceWorker._listeners.has('message')).toBe(false);
  });

  it('treats a dead worker as an error, not a success', async () => {
    const dead = registrationWith({
      postMessage: () => {
        throw new Error('context destroyed');
      },
    });
    await expect(precacheOfflineShell(dead)).resolves.toMatchObject({ state: 'error' });
    await expect(sendPrecacheMessage(dead, ['/_next/static/a.js'])).resolves.toMatchObject({ state: 'error', requested: 1 });
  });
});

describe('which assets are worth keeping', () => {
  it('keeps only same-origin build assets, by pathname', () => {
    const urls = collectShellAssetUrls(
      [
        { name: 'https://pccoe.in/_next/static/chunks/main-app.js' },
        { name: 'https://pccoe.in/_next/static/chunks/app/timetable/%5Bdivision%5D/page.js' },
        { name: 'https://pccoe.in/_next/static/css/timetable.css' },
        { name: 'https://pccoe.in/api/timetable/o' },
        { name: 'https://cdn.example.com/_next/static/ch/x.js' },
        { name: 'https://pccoe.in/login' },
        { name: '' },
        {},
        null,
      ],
      'https://pccoe.in',
    );
    expect(urls).toEqual([
      '/_next/static/chunks/main-app.js',
      '/_next/static/chunks/app/timetable/%5Bdivision%5D/page.js',
      '/_next/static/css/timetable.css',
    ]);
    expect(collectShellAssetUrls()).toEqual([]);
    expect(collectShellAssetUrls([{ name: '/_next/static/a.js' }])).toEqual(['/_next/static/a.js']);
  });

  it('de-duplicates, because a chunk fetched twice must not be cached twice', () => {
    const dupes = [{ name: 'https://pccoe.in/_next/static/chunks/a.js' }, { name: 'https://pccoe.in/_next/static/chunks/a.js' }];
    expect(collectShellAssetUrls(dupes, 'https://pccoe.in')).toEqual(['/_next/static/chunks/a.js']);
  });
});

describe('what the copy is allowed to say', () => {
  it('names the six pill states without over-claiming', () => {
    expect(offlineStateCopy('ready', { savedAgo: 'today 9:10 PM', freshLabel: 'Synced this week' })).toEqual({
      tone: 'ready',
      label: 'Offline copy ready · saved today 9:10 PM',
      detail: 'Synced this week',
    });
    expect(offlineStateCopy('saving').label).toContain('Saving');
    expect(offlineStateCopy('stale', { savedAgo: 'yesterday 7:35 AM' }).label).toContain('Saved copy');
    // A refresh failure is described as "the live one could not be read" — the
    // saved copy is still there, and no wording says the timetable is lost.
    expect(offlineStateCopy('stale').detail).toContain('could not be read');
    expect(offlineStateCopy('error', { error: 'Storage is full' }).detail).toBe('Storage is full');
    expect(offlineStateCopy('unavailable').label).toContain('not saved');
    expect(offlineStateCopy('checking').label).toContain('Checking');
    for (const state of ['ready', 'saving', 'stale', 'error', 'unavailable', 'checking']) {
      const copy = offlineStateCopy(state);
      expect(copy.label, state).toBeTruthy();
      expect(copy.detail, state).toBeTruthy();
    }
  });

  it('walks the eight button states in the right order of precedence', () => {
    const base = { savedReady: false, preparing: false, installOutcome: null, installPath: 'native', error: null, division: 'O' };
    expect(primaryAction(base).label).toBe('Save timetable for offline use');
    expect(primaryAction({ ...base, preparing: true }).label).toBe('Preparing offline timetable…');
    expect(primaryAction({ ...base, preparing: true }).disabled).toBe(true);
    expect(primaryAction({ ...base, installOutcome: 'waiting' }).label).toBe('Waiting for installation confirmation…');
    // "Added" is only ever reachable from an outcome, never from a click.
    expect(primaryAction({ ...base, installOutcome: 'accepted' }).label).toBe('Added to Home Screen');
    expect(primaryAction({ ...base, error: 'Storage is full' }).label).toBe('Could not prepare offline copy — Retry');
    expect(primaryAction({ ...base, error: 'x', savedReady: true }).kind).toBe('retry');
    expect(primaryAction({ ...base, savedReady: true }).label).toBe('Add Division O (IT) timetable to Home Screen');
    // iOS is a guide, not a browser's name: the button says what it does (opens the
    // steps), and the sheet is where the platform difference is spelled out.
    expect(primaryAction({ ...base, savedReady: true, installPath: 'ios' }).label).toBe('Add Division O (IT) timetable to Home Screen');
    expect(primaryAction({ ...base, savedReady: true, installPath: 'ios' }).kind).toBe('guide');
    for (const installPath of ['ios', 'manual', 'native']) {
      expect(primaryAction({ ...base, savedReady: true, installPath }).label).not.toMatch(/Safari|Chrome|Firefox|Edge|Dock/i);
    }
    expect(primaryAction({ ...base, savedReady: true, installPath: 'manual' }).kind).toBe('guide');
    // An unknown batch must not produce a fake name on the button.
    expect(primaryAction({ ...base, savedReady: true, division: null }).label).toBe('Add this timetable to Home Screen');
    // Precedence: preparing beats everything, error beats a ready copy.
    expect(primaryAction({ ...base, preparing: true, installOutcome: 'accepted' }).kind).toBe('busy');
    expect(primaryAction({ ...base, savedReady: true, error: 'boom', installOutcome: 'accepted' }).label).toBe('Added to Home Screen');
  });

  it('never claims an icon was added while the outcome is merely a dismissed prompt', () => {
    const dismissed = primaryAction({ savedReady: true, preparing: false, installOutcome: 'dismissed', installPath: 'native', error: null, division: 'J' });
    expect(dismissed.label).not.toContain('Added');
    expect(dismissed.disabled).toBe(false);
    expect(dismissed.kind).toBe('install');
  });
});

describe('the install guide a user is handed', () => {
  const kinds = ['ios', 'android', 'chromium-desktop', 'firefox', 'safari-desktop', 'unknown'];

  it('never makes a step depend on a browser the reader may not be using', () => {
    const browserNames = ['Safari', 'Chrome', 'Edge', 'Opera', 'Brave', 'Firefox', 'Vivaldi', 'Arc'];
    for (const kind of kinds) {
      const text = stepsFor({ kind }).join(' ');
      // A guide may name the browser it is written for — that is the whole point of
      // having one group per platform. What it may not do is tell somebody on Firefox
      // about a menu item only Safari has, or send a desktop user to File →.
      // Case-sensitive on purpose: "without the browser chrome" is a UI term, and a
      // guide is allowed to say that.
      const named = browserNames.filter((name) => new RegExp(`\\b${name}\\b`).test(text));
      expect(named, kind).toEqual(kind === 'firefox' ? ['Firefox'] : []);
      expect(text, kind).not.toMatch(/File →|Add to Dock|address bar/i);
    }
  });

  it('gives every platform something true to do', () => {
    for (const kind of kinds) {
      const steps = stepsFor({ kind });
      expect(steps.length, kind).toBeGreaterThanOrEqual(2);
      for (const step of steps) {
        expect(typeof step, kind).toBe('string');
        expect(step.length, kind).toBeGreaterThan(20);
      }
      // Each guide ends by telling the user what the shortcut is for, or that nothing
      // broke — never by leaving the last tap unexplained.
      expect(steps.join(' '), kind).toMatch(/Home Screen|home screen|shortcut|install item|offline copy/i);
    }
  });

  it('keeps the platform facts it can actually stand behind', () => {
    const ios = stepsFor({ kind: 'ios' }).join(' ');
    expect(ios).toContain('Share');
    expect(ios).toContain('Add to Home Screen');
    // The in-app-browser warning is a tendency, not a universal claim.
    expect(ios).toMatch(/usually/);

    const chromium = stepsFor({ kind: 'chromium-desktop' }).join(' ');
    expect(chromium).toMatch(/menu/);
    expect(chromium).toMatch(/Install app|Add to Home screen/);
    expect(stepsFor({ kind: 'android' })).toEqual(stepsFor({ kind: 'chromium-desktop' }));

    const firefox = stepsFor({ kind: 'firefox' }).join(' ');
    expect(firefox).toMatch(/if your build offers it/);

    // Desktop WebKit is no longer told about a menu only one browser has; it gets the
    // same search-the-menu guide as an unrecognized browser, plus the honest statement
    // that the offline copy is already saved either way.
    const other = stepsFor({ kind: 'safari-desktop' });
    expect(other).toEqual(stepsFor({ kind: 'unknown' }));
    expect(other.join(' ')).toMatch(/every browser names it differently/);
    expect(other.join(' ')).toMatch(/the offline copy is already on this device/);
  });
});

describe('who is asked to install, and when', () => {
  const now = Date.parse('2026-10-25T10:00:00.000Z');
  const iso = (ms) => new Date(now - ms).toISOString();
  const eligible = {
    hasBatch: true,
    hydrated: true,
    mobile: true,
    savedReady: true,
    now,
  };

  it('asks a phone-shaped device only after it has something to open offline', () => {
    expect(installOfferDecision(eligible)).toEqual({ show: true, reason: 'ready' });
    // A fresh phone keeps the weekday controls visible. The manual card still
    // saves first, and the successful save can then lead to this same offer.
    expect(installOfferDecision({ ...eligible, savedReady: false })).toEqual({ show: false, reason: 'save-first' });
  });

  it('never interrupts a device where the answer is already known', () => {
    expect(installOfferDecision({ ...eligible, standalone: true })).toEqual({ show: false, reason: 'installed' });
    expect(installOfferDecision({ ...eligible, installed: true }).reason).toBe('installed');
    expect(installOfferDecision({ ...eligible, hydrated: false }).reason).toBe('checking-device');
    expect(installOfferDecision({ ...eligible, hasBatch: false }).reason).toBe('no-batch');
    // Desktop keeps the card. A modal nobody asked for is not "mobile-first".
    expect(installOfferDecision({ ...eligible, mobile: false }).reason).toBe('not-mobile');
  });

  it('honours a dismissal for a cool-off instead of forever', () => {
    const denied = installOfferDecision({ ...eligible, dismissedAt: iso(60_000) });
    expect(denied).toEqual({ show: false, reason: 'dismissed-recently' });
    expect(installOfferDecision({ ...eligible, dismissedAt: iso(TIMETABLE_INSTALL_OFFER_COOLDOWN_MS + 1) }).show).toBe(true);
    // A clock that went backwards must not produce a second question this minute.
    expect(installOfferDecision({ ...eligible, dismissedAt: iso(-60_000) }).reason).toBe('dismissed-recently');
    // Corrupt storage mutes nothing: an unreadable stamp is treated as no record,
    // so the offer survives a half-written IndexedDB.
    expect(installOfferDecision({ ...eligible, dismissedAt: 'not-a-date' }).show).toBe(true);
  });

  it('leaves somebody who installed it alone for longer', () => {
    expect(installOfferDecision({ ...eligible, acceptedAt: iso(60_000) }).reason).toBe('installed-recently');
    expect(
      installOfferDecision({ ...eligible, acceptedAt: iso(TIMETABLE_INSTALL_REOFFER_MS + 1) }).show,
    ).toBe(true);
    // A dismissable sheet and an in-flight save are both "not now, ask again later".
    expect(installOfferDecision({ ...eligible, sheet: 'status' }).reason).toBe('sheet-open');
    expect(installOfferDecision({ ...eligible, preparing: true }).reason).toBe('preparing');
    // Once per page view, including after the user closes it: the offer must not
    // re-arm the moment its own sheet disappears.
    expect(installOfferDecision({ ...eligible, alreadyShown: true }).reason).toBe('already-asked');
    // Offline with nothing saved: an install that cannot open would be a lie.
    expect(installOfferDecision({ ...eligible, offline: true, savedReady: false }).reason).toBe('nothing-to-install');
    expect(installOfferDecision({ ...eligible, offline: true, savedReady: true }).show).toBe(true);
    // Installed beats a pending cool-off, and everything beats a missing batch.
    expect(installOfferDecision({ hasBatch: false, standalone: true, dismissedAt: null, now }).reason).toBe('no-batch');
    expect(installOfferDecision({ ...eligible, standalone: true, acceptedAt: null, dismissedAt: iso(0) }).reason).toBe('installed');
  });

  it('reads a phone as a phone, and nothing else as one', () => {
    const coarse = (query) => ({ matches: query === '(pointer: coarse)' });
    expect(isMobileFormFactor({ matchMedia: coarse, navigatorLike: { maxTouchPoints: 5 }, innerWidth: 1440, innerHeight: 900 })).toBe(true);
    expect(isMobileFormFactor({ matchMedia: () => ({ matches: false }), navigatorLike: { maxTouchPoints: 1 }, innerWidth: 390, innerHeight: 844 })).toBe(true);
    expect(isMobileFormFactor({ matchMedia: () => ({ matches: false }), navigatorLike: { maxTouchPoints: 0 }, innerWidth: 390, innerHeight: 844 })).toBe(false);
    expect(isMobileFormFactor({ matchMedia: coarse, navigatorLike: {}, innerWidth: 0, innerHeight: 0 })).toBe(false);
    expect(isMobileFormFactor({})).toBe(false);
    expect(
      isMobileFormFactor({
        matchMedia: () => {
          throw new Error('no matchMedia');
        },
        navigatorLike: { maxTouchPoints: 3 },
        innerWidth: 1200,
        innerHeight: 800,
      }),
    ).toBe(false);
  });
});

describe('what the offer may promise', () => {
  it('offers the native dialog only when there is an event to open it', () => {
    expect(offerAction({ hasPrompt: true, preparing: false, installOutcome: 'unknown', error: null })).toEqual({
      label: 'Install app',
      disabled: false,
      kind: 'install',
    });
    // No event, no claim: the button opens steps, and a browser with no dialog at
    // all is never handed a control that quietly does nothing.
    const manual = offerAction({ hasPrompt: false, preparing: false, installOutcome: null, error: null });
    expect(manual.kind).toBe('guide');
    expect(manual.label).toMatch(/installation steps/i);
    expect(manual.label).not.toMatch(/install (now|app)/i);
    for (const installOutcome of [null, 'unsupported', 'dismissed']) {
      expect(offerAction({ hasPrompt: false, preparing: false, installOutcome, error: null }).disabled).toBe(false);
    }
  });

  it('shows progress and never disables the way out', () => {
    const busy = offerAction({ hasPrompt: true, preparing: true, installOutcome: null, error: null });
    expect(busy).toEqual({ label: 'Preparing offline copy…', disabled: true, kind: 'busy' });
    expect(offerAction({ hasPrompt: true, preparing: false, installOutcome: 'waiting', error: null }).disabled).toBe(true);
    expect(offerAction({ hasPrompt: true, preparing: false, installOutcome: 'accepted', error: null }).label).toBe(
      'Added to Home Screen',
    );
    // A failed save is said out loud, and the button keeps a way forward.
    expect(offerAction({ hasPrompt: false, preparing: false, installOutcome: null, error: 'Storage is full' }).kind).toBe('guide');
  });

  it('says the true thing for the path this browser has', () => {
    const native = offerSummary({ installPath: 'native', savedReady: true });
    expect(native).toMatch(/Chrome asks/);
    expect(native).toMatch(/cannot tick the box for you/i);
    const ios = offerSummary({ installPath: 'ios', savedReady: true });
    expect(ios).toMatch(/Share sheet/);
    expect(ios).not.toMatch(/Chrome/i);
    const manual = offerSummary({ installPath: 'manual', savedReady: false });
    expect(manual).toMatch(/this page/);
    for (const path of ['native', 'ios', 'manual']) {
      for (const saved of [true, false]) {
        const text = offerSummary({ installPath: path, savedReady: saved });
        expect(text.length).toBeGreaterThan(40);
        // Nothing in the offer may claim the icon exists yet.
        expect(text).not.toMatch(/has been added|is installed on your/i);
      }
    }
  });
});
