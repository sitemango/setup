import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MOBILE_NAV, PRIMARY_NAV, ROUTES } from '@/lib/constants';

/**
 * The first-visit guide: does it point at real places, say true things, stay
 * reachable without a session, and avoid becoming a second onboarding.
 *
 * The risk in a page like this is not layout, it is drift: a destination renamed a
 * month later, a privacy line that stops matching the code, a "what is Campus+"
 * paragraph forked into a second voice. So most of this file compares the guide to
 * the repository — every route it names must exist, every claim it makes must be
 * one the app keeps, and the onboarding page must render a *subset* of the same
 * content rather than its own.
 */

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/** Every page in the app, as the URLs Next will actually serve. */
function servedRoutes() {
  const routes = new Set();
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Route groups `(app)` do not appear in the URL; dynamic segments do.
        const segment = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${entry.name.replace(/\[(\.\.\.)?([^\]]+)\]$/, ':$2')}`;
        walk(absolute, segment);
      } else if (entry.name === 'page.js' || entry.name === 'page.jsx') {
        routes.add(prefix === '' ? '/' : prefix);
      }
    }
  };
  walk(path.join(ROOT, 'app'), '');
  return routes;
}

const ROUTE_SET = servedRoutes();

/** `/timetable/:division` answers `/timetable/o`, so a prefix match is the rule. */
function routeExists(href) {
  if (ROUTE_SET.has(href)) return true;
  const segments = href.split('/').filter(Boolean);
  for (const route of ROUTE_SET) {
    const parts = route.split('/').filter(Boolean);
    if (parts.length !== segments.length) continue;
    if (parts.every((part, index) => part.startsWith(':') || part === segments[index])) return true;
  }
  return false;
}

const { GuidePage } = await import('@/components/guide/GuidePage');
const content = await import('@/lib/guide/content');
const {
  clearGuideSeen,
  deviceStorage,
  GUIDE_SEEN_KEY,
  GUIDE_SEEN_PREHYDRATION_SCRIPT,
  GUIDE_SEEN_STYLE_ID,
  markGuideSeen,
  readGuideSeen,
  shouldOfferGuide,
} = await import('@/lib/guide/first-visit');

const render = (props) => renderToStaticMarkup(React.createElement(GuidePage, props));
const text = (props) =>
  render(props)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** A storage stub that behaves like a browser's, including the broken ones. */
const storageStub = ({ value = null, throws = false } = {}) => {
  const store = new Map(value === null ? [] : [[GUIDE_SEEN_KEY, value]]);
  return {
    store,
    getItem(key) {
      if (throws) throw new Error('SecurityError: storage is blocked');
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, next) {
      if (throws) throw new Error('QuotaExceededError');
      store.set(key, next);
    },
    removeItem(key) {
      if (throws) throw new Error('SecurityError');
      store.delete(key);
    },
  };
};

describe('the guide only names places that exist', () => {
  it('has at least one route file for every href it links', () => {
    const links = content.guideLinks();
    // A sanity floor: the map is meant to cover the product, not three links.
    expect(links.length).toBeGreaterThan(18);
    for (const link of links) {
      expect(routeExists(link.href), `${link.label} → ${link.href}`).toBe(true);
    }
  });

  it('serves those routes under one of the two real directories', () => {
    // Guards the resolver itself: a typo in `servedRoutes` would pass everything.
    expect(ROUTE_SET.has('/explore')).toBe(true);
    expect(ROUTE_SET.has('/campus/lost-found')).toBe(true);
    expect(ROUTE_SET.has('/timetable/:division')).toBe(true);
    expect(ROUTE_SET.has('/guide')).toBe(true);
    expect(ROUTE_SET.has('/nope-not-a-page')).toBe(false);
  });

  it('points at /explore and /timetable, not at their legacy aliases', () => {
    const hrefs = content.guideLinks().map((link) => link.href);
    // `/campus/clubs` is a redirect and `/market/gigs/:id` an old address; a guide
    // that links a redirect still works and quietly hides that the canonical
    // route moved. Link the destination.
    expect(hrefs).not.toContain('/campus/clubs');
    expect(hrefs.filter((href) => href.startsWith('/market/gigs'))).toEqual([]);
    expect(hrefs).toContain('/clubs');
    expect(hrefs).toContain('/gigs');
  });

  it('groups the product instead of flattening it into equal cards', () => {
    const primary = content.GUIDE_GROUPS.filter((group) => group.emphasis === 'primary');
    const list = content.GUIDE_GROUPS.filter((group) => group.emphasis === 'list');
    const quiet = content.GUIDE_GROUPS.filter((group) => group.emphasis === 'quiet');
    expect(primary.length).toBe(3);
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(quiet).toHaveLength(1);
    // Every group carries its own number and the primary ones carry a reason.
    for (const group of content.GUIDE_GROUPS) {
      expect(group.number).toMatch(/^\d\d$/);
      expect(group.links.length).toBeGreaterThan(0);
      for (const link of group.links) expect(link.note.length).toBeGreaterThan(12);
    }
    for (const group of [...primary, ...list]) expect(group.why).toBeTruthy();
  });
});

describe('what the guide is allowed to claim', () => {
  const words = text({ state: 'signedOut' });

  it('says it is an independent student project, in the plain words', () => {
    expect(words).toMatch(/independent student project for PCCOE/);
    expect(words).toMatch(/not an official PCCOE service/);
    expect(words).toMatch(/does not review or endorse/);
  });

  it('never offers a number it has not measured', () => {
    // No member counts, no "10,000 students", no fabricated activity.
    expect(words).not.toMatch(/\b\d{1,3},\d{3}\b/);
    expect(words).not.toMatch(/\b\d+\s+(students|members|users|posts|listings|clubs|events|ratings)\b/i);
    expect(words).not.toMatch(/★|✓ \d+/);
  });

  it('does not promise anonymity, privacy or safety it cannot keep', () => {
    expect(words).toMatch(/opposite of anonymous/);
    expect(words).not.toMatch(/(stay|remain|be|fully|completely) anonymous/i);
    expect(words).not.toMatch(/100% private|entirely private|perfectly private/i);
    expect(words).not.toMatch(/always (reviewed|removed|caught)/i);
    expect(words).toMatch(/No moderation catches everything/);
  });

  it('calls moderation what it is: after the fact, by people', () => {
    expect(words).toMatch(/moderated after they appear, not before/);
    expect(words).toMatch(/human|people holding a moderator/);
    expect(words).toMatch(/logged/);
    // No claim that posts are pre-approved, and no claim staff read the queue.
    expect(words).not.toMatch(/reviewed before (they )?(go live|are published) by staff/i);
  });

  it('keeps the ordering claim exact: deterministic, not absent', () => {
    expect(words).toContain(content.GUIDE_DIFFERENCE[1].title);
    expect(words).toMatch(/published formula/);
    expect(words).toMatch(/no model|by a model/);
    expect(text()).not.toMatch(/nothing is ranked|never ranked|not ranked/);
    expect(read('lib/guide/content.js')).toContain('TRENDING_FORMULA');
  });

  it('explains an empty board instead of implying populated data', () => {
    const privacy = content.GUIDE_PRIVACY.map((note) => `${note.title} ${note.body}`).join(' ');
    expect(privacy).toMatch(/empty board|empty list/i);
    expect(privacy).toMatch(/nobody has posted/);
    expect(words).toMatch(/blank where nothing has been published/);
  });

  it('does not describe a feature the repository does not have', () => {
    // The absence has to be *said* ("no uploads, no image feed"), so what must be
    // absent is any affirmative claim that a thing exists. These are the shapes a
    // invented feature would take in prose.
    for (const forbidden of [
      /you can (upload|post a photo|share a file|attach)/i,
      /photo (album|sharing|upload)/i,
      /upload (a|your|files|images)/i,
      /\b(stories|reels|shorts)\b/i,
      /AI recommend|personalis|personaliz|curated for you/i,
      /paid promotion|advertis[ei]ment (can|is|will)|buy a placement|promote a post/i,
      /verified badge|blue tick/i,
      /chatbot|assistant that answers/i,
      /email digest|newsletter/i,
    ]) {
      expect(words, String(forbidden)).not.toMatch(forbidden);
    }
    // And the denials themselves have to be on the page, or "we lack these things"
    // has quietly been edited out and the copy above is no longer checked.
    expect(words).toMatch(/No uploads and no image feed/);
    expect(words).toMatch(/nothing is sponsored/);
    expect(words).toMatch(/No recommendations, no advertising/);
  });
});

describe('the guide renders for every state it serves', () => {
  it('keeps one h1 and the five parts, in order', () => {
    const html = render({ state: 'signedOut' });
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    const headings = [...html.matchAll(/<h2[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(headings).toEqual([
      'Where everything is',
      'Three things, then you know the place',
      'Who sees what',
      'Why it is built this way',
      'Start with your profile',
    ]);
  });

  it('labels every section from a heading that exists', () => {
    const html = render({ state: 'signedIn' });
    const labelled = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
    expect(labelled.length).toBeGreaterThanOrEqual(5);
    for (const id of labelled) {
      expect(html, id).toContain(`id="${id}"`);
    }
  });

  it('never renders a link that goes nowhere or says nothing', () => {
    for (const state of ['signedOut', 'onboarding', 'signedIn', 'welcome']) {
      const html = render({ state });
      // `(?=[\s>])` because `<a` is also the start of `<aside>` and `<article>`.
      const anchors = [...html.matchAll(/<a(?=[\s>])([^>]*)>([\s\S]*?)<\/a>/g)];
      expect(anchors.length, state).toBeGreaterThan(15);
      for (const [, attributes] of anchors) {
        const href = /href="([^"]*)"/.exec(attributes)?.[1];
        expect(href, `missing href in ${state}`).toBeTruthy();
        expect(href, `empty href in ${state}`).not.toBe('#');
        expect(href, `javascript: href in ${state}`).not.toMatch(/^javascript:/);
      }
    }
  });

  it('answers the three first steps from where the reader stands', () => {
    expect(text({ state: 'signedOut' })).toMatch(/Create your profile/);
    expect(render({ state: 'signedOut' })).toContain('href="/login"');
    expect(text({ state: 'onboarding' })).toMatch(/You are doing this now/);
    expect(render({ state: 'onboarding' })).toContain('href="/onboarding"');
    expect(text({ state: 'signedIn' })).toMatch(/Check your profile/);
    expect(render({ state: 'signedIn' })).toContain('href="/profile"');
  });

  it('ends on the right door for each state', () => {
    const signedOut = render({ state: 'signedOut' });
    expect(signedOut).toContain('Sign in with Google');
    expect(signedOut).not.toContain('href="/home"');

    const signedIn = render({ state: 'signedIn' });
    expect(signedIn).toContain('Open Home');
    expect(signedIn).toContain('Back to campus');

    const welcome = text({ state: 'welcome' });
    expect(welcome).toMatch(/Profile done/);
    expect(welcome).toMatch(/Search something you need/);
    // `?welcome=1` must not strand anyone: Home is one tap, in the same place.
    expect(render({ state: 'welcome' })).toContain('href="/home"');
  });

  it('never sends a student who is already signed in back to sign-in', () => {
    // `onboarding` is the state where a copied CTA would be a loop: the reader has
    // a session and no profile, so the only door worth offering is the form.
    for (const state of ['signedIn', 'welcome', 'onboarding']) {
      const exit = content.GUIDE_EXIT[state];
      expect(exit, state).toBeDefined();
      expect(exit.href, state).not.toBe(ROUTES.login);
    }
    expect(content.GUIDE_EXIT.signedOut.href).toBe(ROUTES.login);

    const html = render({ state: 'onboarding' });
    expect(html).toContain(`href="${ROUTES.onboarding}"`);
    expect(html).not.toContain('Sign in with Google');
    expect(html).toContain(content.GUIDE_EXIT.onboarding.cta);
  });

  it('tells the reader how to come back, and does not nag', () => {
    const words = text({ state: 'signedIn' });
    expect(words).toMatch(/account menu/i);
    expect(words).toMatch(/mobile menu/i);
    expect(words).toMatch(/⌘K/);
    expect(words).toMatch(/will not reopen itself/);
  });

  it('hides the in-app escape hatch from a signed-out reader', () => {
    // No "Open Home" for someone who cannot open Home; they get Sign in instead.
    expect(render({ state: 'signedOut' })).toContain('Sign in');
    expect(text({ state: 'signedOut' })).not.toMatch(/Open Home/);
  });

  it('underlines the headline with the mechanism the width can carry', () => {
    // A drawn stroke cannot follow a wrapped line, and the headline wraps below
    // 30rem. Both mechanisms are in the sheet; the narrow one is a real text
    // decoration, so it repeats on every line the words land on.
    const css = read('app/styles/guide.css');
    expect(css).toMatch(/\.guide-hero__ink \.[\s\S]{0,40}text-decoration-style: wavy|text-decoration-style: wavy/);
    expect(css).toMatch(/@media \(min-width: 30rem\)[\s\S]*?\.guide-hero__ink \.guide-hero__underline \{\s*display: block/);
    // `.guide-mark` sets `display: block` later in the same sheet, so the narrow
    // rule has to out-specify it or the stroke shows through the wavy line.
    expect(css).toMatch(/\.guide-hero__ink \.guide-hero__underline \{\s*display: none/);
  });

  it('marks its decorative ink as decoration', () => {
    const html = render({ state: 'signedOut' });
    const svgs = [...html.matchAll(/<svg[^>]*>/g)].map((match) => match[0]);
    expect(svgs.length).toBeGreaterThan(4);
    for (const svg of svgs) {
      expect(svg).toMatch(/aria-hidden="true"|aria-hidden=""|focusable="false"/);
    }
    // Every drawn mark is inline SVG: the page ships no <img> (spec §71).
    expect(html).not.toContain('<img');
  });
});

describe('the guide is public, and public means empty', () => {
  const page = read('app/guide/page.js');
  const stripped = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('is reachable signed out, and does not require a session', () => {
    expect(page).not.toMatch(/requireUser|redirect\(/);
    expect(page).toMatch(/getCurrentUser\(\)/);
    // It must answer even when the deployment has no configuration at all.
    expect(page).toContain('isSupabaseConfigured()');
  });

  it('cannot reach a table: no client, no query, no profile fields', () => {
    // `isSupabaseConfigured` is allowed to appear (it is the guard); a client, a
    // query or an RPC is not.
    expect(stripped).not.toMatch(/getServerClient|getAdminClient|createClient|@supabase|\.from\(|\.rpc\(/);
    expect(stripped).not.toMatch(/user\.email|user\.profile|profile\.|cookies\(\)/);
    // The only thing taken from the session is which question to answer first.
    expect(stripped).toMatch(/user\.needsProfileSetup/);
  });

  it('is never a cached prerender, so the state cannot belong to the wrong reader', () => {
    expect(page).toContain("export const dynamic = 'force-dynamic'");
  });

  it('is added to the proxy list and to nothing else', () => {
    const proxy = read('proxy.js');
    const publicPaths = /PUBLIC_PATHS = \[([^\]]*)\]/.exec(proxy)?.[1] ?? '';
    const list = [...publicPaths.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    // An exact pin: this array is the whole of what unauthenticated visitors may
    // reach, so an addition here has to be a deliberate edit, never a side effect.
    expect(list).toEqual(['/login', '/login/verify', '/auth', '/setup', '/legal', '/rules', '/guide', '/timetable']);
    // `/guide` is matched as a path and a prefix, like its two neighbours: no
    // `/guide/admin`-style surprise exists, and the page itself renders no data.
    expect(proxy).toMatch(/pathname === prefix \|\| pathname\.startsWith\(`\$\{prefix\}\/`\)/);
  });

  it('styles what it renders, where it renders it', () => {
    // The strip is mounted by Home, not by /guide, so it cannot borrow the
    // guide's sheet: without its own import the offer would render as a bare
    // sentence under the header. Home's layout keeps it out of other routes.
    expect(read('app/(app)/home/layout.js')).toContain("@/app/styles/guide-strip.css");
    expect(read('app/(app)/layout.js')).not.toContain("@/app/styles/guide-strip.css");
    expect(read('app/styles/guide-strip.css')).toContain('.guide-strip__dismiss');
    expect(read('app/styles/guide-strip.css')).toMatch(/prefers-reduced-motion/);
    // …and the page sheet keeps the page, so nothing else downloads it.
    expect(read('app/guide/layout.js')).toContain("@/app/styles/guide.css");
    expect(read('app/styles/guide.css')).not.toMatch(/^\.guide-strip \{/m);
  });

  it('lives outside the authenticated route group', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/guide/page.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'app/(app)/guide'))).toBe(false);
    // …and it owns its stylesheet the way Home owns home.css.
    expect(read('app/guide/layout.js')).toContain("@/app/styles/guide.css");
    expect(read('app/globals.css')).not.toContain('guide.css');
  });
});

describe('the first-visit flag, on the device', () => {
  it('reads "not yet" and "already" apart from "cannot tell"', () => {
    expect(readGuideSeen(storageStub())).toBe(false);
    expect(readGuideSeen(storageStub({ value: '2026-10-26T10:00:00.000Z' }))).toBe(true);
    // A value written by any older build still counts; an empty one does not.
    expect(readGuideSeen(storageStub({ value: '1' }))).toBe(true);
    expect(readGuideSeen(storageStub({ value: '' }))).toBe(false);
    expect(readGuideSeen(undefined)).toBeNull();
    expect(readGuideSeen({})).toBeNull();
    expect(readGuideSeen(storageStub({ throws: true }))).toBeNull();
  });

  it('writes best-effort and never throws at the caller', () => {
    const storage = storageStub();
    expect(markGuideSeen(storage, 'stamped')).toBe(true);
    expect(storage.store.get(GUIDE_SEEN_KEY)).toBe('stamped');
    expect(markGuideSeen(storageStub({ throws: true }))).toBe(false);
    expect(markGuideSeen(undefined)).toBe(false);
    expect(clearGuideSeen(storage)).toBe(true);
    expect(readGuideSeen(storage)).toBe(false);
    expect(clearGuideSeen(storageStub({ throws: true }))).toBe(false);
  });

  it('hides only an already-seen SSR offer before paint, including legacy values', () => {
    const runPrehydration = ({ value = null, throws = false } = {}) => {
      const appended = [];
      const document = {
        createElement(tag) {
          expect(tag).toBe('style');
          return {};
        },
        head: { appendChild: (node) => appended.push(node) },
      };
      const window = {
        localStorage: {
          getItem(key) {
            expect(key).toBe(GUIDE_SEEN_KEY);
            if (throws) throw new DOMException('The operation is insecure.');
            return value;
          },
        },
      };
      const execute = new Function('window', 'document', GUIDE_SEEN_PREHYDRATION_SCRIPT);
      expect(() => execute(window, document)).not.toThrow();
      return appended;
    };

    for (const value of [null, '', '0']) expect(runPrehydration({ value })).toEqual([]);
    for (const value of ['1', '2026-10-26T10:00:00.000Z']) {
      const [style] = runPrehydration({ value });
      expect(style.id).toBe(GUIDE_SEEN_STYLE_ID);
      expect(style.textContent).toBe('.guide-strip{display:none!important}');
    }
    expect(runPrehydration({ throws: true })).toEqual([]);

    const home = read('app/(app)/home/page.js');
    expect(home).toContain('{GUIDE_SEEN_PREHYDRATION_SCRIPT}</script>');
    expect(home.indexOf('{GUIDE_SEEN_PREHYDRATION_SCRIPT}</script>')).toBeLessThan(home.indexOf('<GuideWelcomeStrip />'));
    expect(read('app/layout.js')).not.toContain('GUIDE_SEEN_PREHYDRATION_SCRIPT');
    expect(read('components/layout/AppShell.js')).not.toContain('GuideWelcomeStrip');
    const strip = read('components/guide/GuideWelcomeStrip.js');
    expect(strip).toMatch(/function readServerSnapshot\(\) \{\s*return false;/);
  });

  it('offers itself only on Home, only to a device that has not seen it', () => {
    expect(shouldOfferGuide({ seen: false, onHome: true })).toBe(true);
    expect(shouldOfferGuide({ seen: true, onHome: true })).toBe(false);
    expect(shouldOfferGuide({ seen: null, onHome: true })).toBe(true);
    expect(shouldOfferGuide({ seen: false, onHome: false })).toBe(false);
    expect(shouldOfferGuide({ seen: false, onHome: true, hidden: true })).toBe(false);
    expect(shouldOfferGuide()).toBe(false);
  });

  it('is one key, namespaced, and holds no content or identity', () => {
    expect(GUIDE_SEEN_KEY).toBe('campusplus:guide-seen');
    const storage = storageStub();
    markGuideSeen(storage);
    // A timestamp, not a user id, not a session token, not the guide's text.
    expect(storage.store.get(GUIDE_SEEN_KEY)).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('needs no migration, because the flag is not a database concern', () => {
    const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'));
    expect(migrations.some((file) => /guide/i.test(file))).toBe(false);
    expect(read('supabase/bundle/campus-plus-schema.sql')).not.toMatch(/guide_seen|first_visit/i);
  });

  it('treats blocked storage as "cannot tell", not as a crash', () => {
    // A locked-down WebView throws on the property read itself, so the guard has
    // to sit around the read. `null` means unknown: offer, promise nothing.
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        get localStorage() {
          throw new DOMException('The operation is insecure.');
        },
      },
    });
    try {
      const storage = deviceStorage();
      expect(storage).toBe(null);
      expect(readGuideSeen(storage)).toBe(null);
      expect(markGuideSeen(storage)).toBe(false);
      expect(clearGuideSeen(storage)).toBe(false);
      expect(shouldOfferGuide({ seen: storage === null ? null : false, onHome: true })).toBe(true);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else delete globalThis.window;
    }
    // And a normal browser still reads through the same door.
    const memory = new Map();
    const fake = {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    };
    expect(readGuideSeen(fake)).toBe(false);
    expect(markGuideSeen(fake, '2026-10-26T00:00:00.000Z')).toBe(true);
    expect(readGuideSeen(fake)).toBe(true);
  });

  it('is read through a store hook, not a setState in an effect', () => {
    const strip = read('components/guide/GuideWelcomeStrip.js');
    expect(strip).toContain('useSyncExternalStore');
    expect(strip).not.toMatch(/useEffect\(/);
    // Opening the page is the signal, so the page itself marks it seen.
    expect(read('components/guide/GuideSeenMarker.js')).toContain('markGuideSeen(deviceStorage())');
    // Neither reader nor writer may touch the property itself: some builds throw
    // on the read, and an exception there takes the page down with it.
    for (const file of ['components/guide/GuideWelcomeStrip.js', 'components/guide/GuideSeenMarker.js']) {
      expect(read(file), file).not.toMatch(/window\.localStorage/);
    }
    // Mounted by the page component itself, so no state can forget to record it.
    expect(read('components/guide/GuidePage.js')).toContain('<GuideSeenMarker />');
  });
});

describe('one onboarding, not two', () => {
  it('sends a new profile to the guide, and the guide sends them on to Home', () => {
    expect(read('components/auth/OnboardingForm.js')).toContain("redirectTo: '/guide?welcome=1'");
    expect(render({ state: 'welcome' })).toContain('href="/home"');
  });

  it('renders the onboarding intro from the guide content, not its own copy', () => {
    const intro = read('components/auth/OnboardingIntro.js');
    expect(intro).toContain("@/lib/guide/content");
    // The failure this prevents: a second, independently written explanation.
    expect(intro).not.toMatch(/const (NOTES|DESTINATIONS) = /);
    expect(intro).toContain('GUIDE_HEADLINE_LEAD');
    expect(intro).toContain('GUIDE_OPENING_SHORT');
    expect(intro).toContain('GUIDE_GROUPS.filter');
    // …and it still links the whole thing.
    expect(intro).toContain('ROUTES.guide');
  });

  it('keeps the onboarding guards exactly where they were', () => {
    const page = read('app/onboarding/page.js');
    expect(page).toContain("if (!isSupabaseConfigured()) redirect('/setup')");
    expect(page).toContain('if (!user) redirect(\'/login\')');
    expect(page).toContain("if (!user.needsProfileSetup) redirect('/home')");
    expect(page).toContain('<OnboardingIntro />');
  });

  it('leaves the root route\u2019s authentication decisions alone', () => {
    const root = read('app/page.js');
    expect(root).toContain("redirect('/setup')");
    expect(root).toContain("redirect('/login')");
    expect(root).toContain("redirect('/onboarding')");
    expect(root).toContain('redirect(ROUTES.home)');
    // The guide is an entrance, never the redirect target of `/`.
    expect(root).not.toMatch(/guide/);
  });
});

describe('the guide is reachable from where students already are', () => {
  it('sits in the account menu, the mobile sheet and the actions list', () => {
    expect(read('components/layout/AccountMenu.js')).toMatch(/href=\{ROUTES\.guide\}[\s\S]*First-visit guide/);
    expect(read('components/layout/MobileMenu.js')).toContain('href={ROUTES.guide}');
    const layout = read('app/(app)/layout.js');
    expect(layout).toMatch(/label: 'First-visit guide', href: ROUTES\.guide/);
  });

  it('does not enlarge either navigation set', () => {
    expect(PRIMARY_NAV).toHaveLength(8);
    expect(MOBILE_NAV).toHaveLength(5);
  });

  it('answers the two public places that already asked about it', () => {
    const login = read('app/login/page.js');
    expect(login).toContain('href="/guide"');
    expect(login).toMatch(/first-visit guide/i);
    const rules = read('app/rules/page.js');
    // "What is Campus+?" used to point at `/`, which answers with a redirect to
    // sign-in. Now the question has an answer.
    expect(rules).toMatch(/href="\/guide"[^>]*>[\s\S]{0,80}What is Campus\+/);
    expect(rules).not.toMatch(/href="\/"[^>]*>\s*\n?\s*What is Campus\+/);
  });

  it('keeps the guide out of the guide as a second navigation', () => {
    // The in-page jump row names the guide's own parts, never the app's routes.
    const html = render({ state: 'signedOut' });
    const jump = /<nav[^>]*aria-label="Jump to a part of this guide"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(jump).toContain('href="#map"');
    expect(jump).toContain('href="#privacy"');
    expect(jump).not.toMatch(/href="\/(home|explore|market|chat|settings)"/);
  });
});
