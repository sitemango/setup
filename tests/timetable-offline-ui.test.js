import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { divisionFromPathname } from '@/components/timetable/TimetableOfflineShell';

/**
 * Where the feature lives, and what it must never do.
 *
 * The behavioural tests cover "does offline work". These cover the parts that
 * are easy to break from the *other* direction: a student noticing the install
 * button on their chat page, a second service worker registered for a different
 * feature, an env var ending up inside a browser bundle, a rebuild leaving the
 * committed worker out of date with the policy that is unit-tested. Those are
 * all one careless edit away, and all of them are cheap to assert on the
 * repository itself.
 */

const ROOT = process.cwd();
const files = (dir, filter = () => true) => {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (/\.(js|mjs)$/.test(entry.name) && filter(full)) {
        out.push(full);
      }
    }
  };
  walk(path.join(ROOT, dir));
  return out;
};
const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
/** Prose is not code: a doc comment may *describe* a forbidden pattern. */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const OFFLINE_UI = ['TimetableInstallCard', 'TimetableInstallSheet', 'TimetableOfflinePill', 'TimetableOfflineProvider'];

describe('the offline shell page', () => {
  it('takes the batch from the address it was served under', () => {
    expect(divisionFromPathname('/timetable/o')).toBe('O');
    expect(divisionFromPathname('/timetable/J')).toBe('J');
    // The shell's own address is not a batch, and neither is anything else.
    expect(divisionFromPathname('/timetable/offline')).toBeNull();
    // The *pathname* is the input, never the search string — so a query can
    // neither select a batch nor confuse the shell.
    expect(divisionFromPathname('/timetable/o?day=Mon')).toBeNull();
    expect(divisionFromPathname('/timetable/it-first-year')).toBeNull();
    expect(divisionFromPathname('/timetable/o/extra')).toBeNull();
    expect(divisionFromPathname('/home')).toBeNull();
    expect(divisionFromPathname('')).toBeNull();
    expect(divisionFromPathname(undefined)).toBeNull();
  });

  it('is a static page, so the worker can serve it without a server', () => {
    const page = read('app/timetable/offline/page.js');
    expect(page).toMatch(/export const dynamic = 'force-static'/);
    expect(page).toMatch(/TimetableOfflineShell/);
    // It must not try to fetch the database at build time.
    expect(page).not.toMatch(/getDivisionTimetable|revalidate/);
  });

  it('navigates with plain links, because an offline RSC fetch cannot land', () => {
    const shell = read('components/timetable/TimetableOfflineShell.js');
    expect(shell).not.toMatch(/from 'next\/link'/);
    expect(shell).toMatch(/href=\{ROUTES\.timetableDivision/);
    // …and it reuses the real timetable renderer instead of a second one.
    expect(shell).toMatch(/import TimetableLive from '@\/components\/timetable\/TimetableLive'/);
  });
});

describe('automatic snapshot refresh', () => {
  it('skips the network when there is no saved copy, but keeps explicit save and saved-copy refresh', () => {
    const provider = code(read('components/timetable/TimetableOfflineProvider.js'));
    const refresh = provider.slice(provider.indexOf('const refresh ='), provider.indexOf('Capture the install event'));
    const skip = refresh.indexOf('if (!savedRef.current)');
    const fetch = refresh.indexOf('fetch(batch.apiUrl,');
    expect(skip).toBeGreaterThanOrEqual(0);
    expect(fetch).toBeGreaterThan(skip);
    expect(refresh.match(/skipped: 'not-saved'/g)).toHaveLength(1);
    expect(refresh).toContain('saveBatch({ ...validated.snapshot');
    // The opt-in preparation path is independent and must still fetch.
    expect(provider).toContain('const fetched = await fetchSnapshot(batch)');
  });
});

describe('placement: the install action belongs to the timetable and nowhere else', () => {
  const offenders = files('app', (file) => !relative(file).startsWith('app/timetable')).filter((file) =>
    OFFLINE_UI.some((name) => fs.readFileSync(file, 'utf8').includes(name)),
  );

  it('is absent from every page outside /timetable', () => {
    expect(offenders.map(relative)).toEqual([]);
  });

  it('is not on the timetable index either — only on a batch page', () => {
    const index = read('app/timetable/page.js');
    expect(index).not.toMatch(/TimetableInstallCard|TimetableOfflinePill/);
    const division = read('app/timetable/[division]/page.js');
    expect(division).toMatch(/<TimetableInstallCard/);
    expect(division).toMatch(/<TimetableInstallSheet/);
    // …and only for a real batch: an unknown division gets the page, not a
    // button that would promise an install for a timetable that does not exist.
    expect(division).toMatch(/offlineSlot=\{batch \? <TimetableOfflinePill \/> : null\}/);
    expect(division).toMatch(/<TimetableOfflineProvider/);
  });

  it('owns the install listeners alone, so no other feature can pop a prompt', () => {
    // A dev tool may *observe* the event (the offline check does, passively);
    // nothing in the shipped app may listen for it except this feature.
    const needle = ['beforeinstall', 'prompt'].join('');
    const listeners = files('.', (file) => {
      const name = relative(file);
      if (name.startsWith('tests/') || name.startsWith('scripts/')) return false;
      return fs.readFileSync(file, 'utf8').includes(needle);
    }).map(relative);
    expect(listeners).toEqual(['lib/timetable/offline-install.js']);
  });

  it('renders exactly one service worker registration call in the app', () => {
    // Nobody may call the API directly: that is how a second worker turns up on
    // a page that was never meant to have one.
    // Built at runtime so this file's own search string is not a hit on itself.
    const direct = ['serviceWorker', '.', 'register('].join('');
    expect(files('.', (file) => !relative(file).startsWith('tests/') && fs.readFileSync(file, 'utf8').includes(direct)).map(relative)).toEqual([]);
    const callers = files('.', (file) => {
      const name = relative(file);
      return (
        !name.startsWith('tests/') &&
        !name.startsWith('scripts/') &&
        fs.readFileSync(file, 'utf8').includes('registerTimetableWorker(')
      );
    }).map(relative);
    expect(callers).toEqual(['components/timetable/TimetableOfflineProvider.js', 'lib/timetable/offline-install.js']);
  });
});

describe('nothing private reaches the browser', () => {
  const clientModules = [
    'lib/timetable/offline-install.js',
    'lib/timetable/offline-store.js',
    'lib/timetable/offline.js',
    'lib/timetable/batch.js',
    'lib/timetable/sw-policy.js',
    'components/timetable/TimetableOfflineProvider.js',
    'components/timetable/TimetableOfflineUi.js',
    'components/timetable/TimetableOfflineShell.js',
    'public/timetable/sw.js',
  ];

  it.each(clientModules)('%s reads no server environment', (file) => {
    const source = code(read(file));
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE|DATABASE_URL|SERVICE_ROLE_KEY|DRIVE_CLIENT_SECRET|CRON_SECRET|APP_SECRET|ENCRYPTION_KEY/);
    // `process.env.NODE_ENV` is inlined by the build and is the only allowed read.
    for (const match of source.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
      expect(match[1], `${file} → ${match[1]}`).toBe('NODE_ENV');
    }
    expect(source).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/);
  });

  it('keeps the worker free of server-only modules, so it can be a classic script', () => {
    const entry = code(read('lib/timetable/sw-entry.mjs'));
    const policy = code(read('lib/timetable/sw-policy.js'));
    for (const source of [entry, policy]) {
      expect(source).not.toMatch(/server-only/);
      expect(source).not.toMatch(/from '@\/lib\/(supabase|auth|data)\//);
      expect(source).not.toMatch(/cookies\(|getServerClient|getCurrentUser/);
    }
    // The bundle the browser actually runs: self-contained, and not importing
    // anything that could reach the dataset or the session.
    const bundle = code(read('public/timetable/sw.js'));
    expect(bundle).not.toMatch(/^\s*import\s/m);
    expect(bundle).not.toMatch(/^\s*export\s/m);
    expect(bundle).not.toMatch(/process\.env/);
    // The minifier rewrites quotes, so match either form.
    for (const event of ['install', 'activate', 'fetch', 'message']) {
      expect(bundle, event).toMatch(new RegExp(`addEventListener\\(["']${event}["']`));
    }
  });

  it('does not pull the server dataset into the offline path', () => {
    for (const file of ['components/timetable/TimetableOfflineShell.js', 'components/timetable/TimetableOfflineProvider.js', 'lib/timetable/offline-store.js']) {
      expect(read(file), file).not.toMatch(/TimetableViews|timetable\/data\//);
    }
  });

  it('writes only the settings allow-list to the device', async () => {
    const store = read('lib/timetable/offline-store.js');
    expect(store).toMatch(/SETTING_KEYS/);
    expect(store).not.toMatch(/localStorage\.setItem\([^)]*(session|token|jwt)/i);
  });
});

describe('the shipped worker matches the tested policy', () => {
  const bundle = read('public/timetable/sw.js');

  it('embeds the cache names and version from lib/timetable/sw-policy.js', async () => {
    const { CACHE_PREFIX, OFFLINE_SHELL_READY_URL, OFFLINE_SHELL_URL, SW_CACHE_VERSION, cacheNames } = await import(
      '@/lib/timetable/sw-policy'
    );
    // The names are assembled from the prefix and the version at activation
    // time, so those two are what has to survive bundling — and `npm run
    // sw:check` is what proves the bundle itself is current with the policy.
    expect(bundle).toContain(CACHE_PREFIX);
    expect(bundle).toContain(SW_CACHE_VERSION);
    for (const part of ['core', 'assets', 'documents']) {
      expect(bundle, part).toContain(part);
    }
    void cacheNames;
    expect(bundle).toContain(OFFLINE_SHELL_URL);
    // The readiness sentinel is what stops a half-cached shell being served as
    // a blank page; it must survive bundling.
    expect(bundle).toContain(OFFLINE_SHELL_READY_URL);
    expect(bundle).toContain('cp:clear'); // removing every saved copy clears our caches too
    expect(bundle).toMatch(/caches\.keys\(\)/);
  });

  it('treats CacheStorage as optional, so a blocked profile cannot break the live page', () => {
    const entry = read('lib/timetable/sw-entry.mjs');
    // One call site, and it is inside the helper that swallows the rejection.
    expect(entry.match(/caches\.open\(/g) ?? []).toHaveLength(1);
    expect(entry).toMatch(/async function openCache\(name\) \{\s*try \{/);
    expect(entry).toMatch(/async function listCaches\(\)/);
    // A worker that cannot cache must still answer the navigation, not fail it.
    expect(entry).toMatch(/if \(!cache\) return fetch\(request\)/);
    expect(entry.match(/await caches\.keys\(\)/g) ?? []).toHaveLength(1); // inside listCaches
  });

  it('carries the removal guards for caches the feature does not own', () => {
    const entry = read('lib/timetable/sw-entry.mjs');
    expect(entry).toMatch(/\.filter\(isOwnedCache\)/);
    expect(entry).toMatch(/caches\.delete/);
    // …and never a blanket `caches.keys().map(delete)` or an origin-wide clear.
    expect(entry).not.toMatch(/caches\.keys\(\)\)\.map\(\(name\)\s*=>\s*caches\.delete/);
    expect(entry).not.toMatch(/caches\.delete\([^)]*\*[^)]*\)/);
  });
});

describe('next.config and proxy stay as this feature needs, and no looser', () => {
  const config = read('next.config.mjs');

  it('allows the worker its wide scope and keeps it out of the HTTP cache', () => {
    expect(config).toMatch(/key: 'Service-Worker-Allowed', value: '\/'/);
    expect(config).toMatch(/\/timetable\/sw\.js/);
    // A cached worker is an update that never arrives.
    expect(config).toMatch(/no-cache|no-store/);
  });

  it('does not weaken the frame guard to make an iframe warm-up work', () => {
    // The shell is precached by the worker fetching it directly, precisely so
    // that this header does not have to be relaxed for anyone.
    expect(config).toMatch(/key: 'X-Frame-Options', value: 'DENY'/);
    expect(config).not.toMatch(/frame-ancestors\s+ALLOW/);
  });
});

describe('presentation follows the system, not a guess', () => {
  const css = read('app/styles/timetable.css');
  const start = css.indexOf('.tt-offline');
  const offline = css.slice(start);

  it('animates only when the user allows it', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\n\}/.exec(offline)?.[0] ?? '';
    expect(block).toMatch(/\.tt-offline__pill/);
    expect(block).toMatch(/\.tt-offline__spinner[\s\S]*?animation:\s*none/);
    expect(block).toMatch(/tt-install__step-mark[\s\S]*?animation:\s*none/);
  });

  it('respects the notch and the home indicator', () => {
    expect(offline).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(offline).toMatch(/env\(safe-area-inset-top\)/);
  });

  it('takes its colours from the shared tokens, so light and dark both work', () => {
    expect(offline).toMatch(/var\(--cp-/);
    // No hard-coded ink or paper: the tokens carry the theme.
    const hexColours = offline.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexColours, hexColours.join(',')).toEqual([]);
    expect(offline).not.toMatch(/!important/);
  });

  it('sizes the action for a thumb, not a cursor', () => {
    // 2.5rem = 40px at the default size, 2.75rem = 44px — the pill and the
    // primary button both clear the 44px target the platform guidelines ask for.
    expect(offline).toMatch(/min-height:\s*2\.(?:5|75)rem/);
  });

  it('leaves the current/next row alone', () => {
    // The offline chrome is additive: it must not sit on top of the live
    // timetable, so nothing in the new CSS may pin an element over the content.
    expect(offline).not.toMatch(/position:\s*fixed;\s*inset:\s*0/);
    expect(offline).not.toMatch(/z-index:\s*(9{4,}|[5-9]\d{3,})/);
  });
});

describe('accessibility of the offline chrome', () => {
  const ui = read('components/timetable/TimetableOfflineUi.js');
  const live = read('components/timetable/TimetableLive.js');

  it('announces status changes as a polite live region', () => {
    expect(ui).toMatch(/role="status"/);
    expect(ui).toMatch(/aria-live="polite"/);
    expect(ui).toMatch(/aria-describedby="tt-offline-detail"/);
    expect(ui).toMatch(/aria-label="Offline preparation progress"/);
  });

  it('says so when the browser refused to keep the page files', () => {
    // Data in IndexedDB and page assets in CacheStorage fail independently, so
    // the copy must be able to distinguish them.
    expect(ui).toMatch(/worker\.state === 'error'/);
    expect(ui).toMatch(/would not keep the page files/);
    expect(ui).toMatch(/Offline caching is not active in development/);
  });

  it('labels every region it renders', () => {
    expect(ui).toMatch(/aria-labelledby="tt-install-title"/);
    expect(ui).toMatch(/aria-hidden="true"/); // decorative icons and dots
  });

  it('uses real controls, and reuses the shared dialog for the sheet', () => {
    expect(ui).toMatch(/<Button\b/);
    expect(ui).toMatch(/<Modal\b/);
    expect(ui).toMatch(/from '@\/components\/ui'/);
    expect(ui).toMatch(/type="button"/);
    // A positive tab index would break the timetable's own focus order.
    expect(ui).not.toMatch(/tabIndex=\{[1-9]/);
    expect(live).toMatch(/\{offlineSlot\}/); // the pill stays inside the header
  });

  it('closes the sheet with the shared Modal’s own controls', () => {
    expect(ui).toMatch(/closeLabel="Close this sheet"/);
    expect(ui).toMatch(/onClose=\{dismissSheet\}/);
    // The sheet is a titled, described dialog — the shared Modal gives it the
    // role, the Escape key and the focus trap, so the feature re-implements none.
    expect(ui).toMatch(/title=\{/);
    expect(ui).toMatch(/description=\{/);
  });
});
