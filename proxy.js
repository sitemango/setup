/**
 * Campus+ — Next.js proxy (formerly `middleware.ts`).
 *
 * Next 16 renamed middleware to `proxy`: the file must export `proxy`, runs on
 * the Node.js runtime, and keeping both `middleware.ts` and `proxy.ts` is a
 * build error. This file does exactly two things:
 *
 *   1. refresh the Supabase session so the auth cookie never expires mid-visit,
 *   2. send signed-out visitors to /login and signed-in visitors away from it.
 *
 * It is deliberately *not* the authorization layer: every page, server action
 * and RLS policy checks permissions again (spec §106, §107). A path the matcher
 * misses is still safe — it just skips the cookie refresh or sends a guest to
 * sign-in when a public page should have been reachable.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { originFromHeaders } from '@/lib/auth/oauth';
import { isKnownRoute } from '@/lib/auth/proxy-routes';

/** Routes that must be reachable without a session. `/legal` and `/rules` are
 * linked from the sign-in screen itself (the independence disclosure and the
 * rules a student agrees to by continuing), so both must render signed out.
 * `/timetable` (and every `/timetable/[division]` under it, via the prefix
 * match below) is a public read-only mirror of the department master
 * timetable — it must work from a shared link before a student has an
 * account, and it changes nothing about any other route's protection. `/guide`
 * joins `/legal` and `/rules` as a public *document*: the first-visit guide is
 * static text with no query, no session data and nothing private in it, and a
 * student deciding whether to make a profile is the reader it exists for.
 * `/map` joins the public set for the same reason as `/timetable`: the campus
 * plan is surveyed, public information a prospective student can be linked
 * straight to, and the page reads no session data of its own. It
 * grants no access to any other route — the pages themselves still re-check. */
const PUBLIC_PATHS = ['/login', '/login/verify', '/auth', '/setup', '/legal', '/rules', '/guide', '/timetable', '/map'];

/**
 * Public discovery (migration 041 / docs/PUBLIC-DISCOVERY.md).
 *
 * These are *exact* paths or single-segment patterns, never broad prefixes:
 * `/clubs` is public while `/clubs/new`, `/clubs/request` and
 * `/clubs/<uuid>/manage` stay protected; `/campus/events` is public while
 * `/campus/events/new` stays protected. Adding `/clubs` or `/campus/events`
 * to PUBLIC_PATHS would have made those prefixes (and every child) public.
 *
 * `/sitemap.xml` is generated from published public records only, so it must
 * be reachable by crawlers without a session. `robots.txt` is already excluded
 * by the matcher below.
 *
 * `/home-preview` is exact-only for the opposite reason: the signed-in Home
 * demo must be reviewable without a session locally, so the proxy lets the
 * exact path through and the page itself answers 404 outside development.
 * It carries only sample data and grants no access to `/home` or any API.
 */
const PUBLIC_EXACT_PATHS = ['/clubs', '/campus/events', '/campus/clubs', '/sitemap.xml', '/home-preview', '/api/reminders/schedule', '/api/reminders/dispatch'];

/** Protected single-segment children of `/clubs`. Static routes win in Next,
 * but the proxy must agree with that decision, not guess. */
const PROTECTED_CLUB_SEGMENTS = new Set(['new', 'request']);
/** The one protected single-segment child of `/campus/events`. */
const PROTECTED_EVENT_SEGMENTS = new Set(['new']);

function stripTrailingSlash(pathname) {
  return pathname !== '/' && pathname.endsWith('/') ? pathname.replace(/\/+$/, '') : pathname;
}

/** `/clubs/<uuid>` — the legacy compatibility redirect, public by design. */
function isPublicClubChild(pathname) {
  const match = /^\/clubs\/([^/]+)$/.exec(pathname);
  return Boolean(match && !PROTECTED_CLUB_SEGMENTS.has(match[1]));
}

/** `/c/<slug>` — the canonical public club profile. */
function isPublicClubSlug(pathname) {
  return /^\/c\/[^/]+$/.test(pathname);
}

/** `/campus/events/<id>` — a published event's public detail page. */
function isPublicEventChild(pathname) {
  const match = /^\/campus\/events\/([^/]+)$/.exec(pathname);
  return Boolean(match && !PROTECTED_EVENT_SEGMENTS.has(match[1]));
}

/** `/campus/clubs/<uuid>` — pre-section compatibility redirect. */
function isPublicLegacyCampusClub(pathname) {
  return /^\/campus\/clubs\/[^/]+$/.test(pathname);
}

/**
 * True when the proxy may let a signed-out visitor through.
 *
 * Exported so the routing regression tests exercise the real matcher rather
 * than a copy of it. Skipping a redirect never authorizes anything: pages,
 * route handlers, server actions, RPCs and RLS still enforce their own rules.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isPublicPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) return false;
  const pathname = stripTrailingSlash(rawPath);
  if (pathname === '/') return true;
  if (pathname === '/onboarding-preview' && process.env.NODE_ENV === 'development') return true;
  // Local fixture sign-in (development only). The route itself answers 404
  // unless the dev server is also pointed at the disposable harness, so letting
  // the path through here grants nothing: it mints a session for a seeded
  // account only, and every page, action and RLS policy still re-checks.
  if (pathname === '/api/dev/session' && process.env.NODE_ENV === 'development') return true;
  if (PUBLIC_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return true;
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true;
  if (isPublicClubChild(pathname)) return true;
  if (isPublicClubSlug(pathname)) return true;
  if (isPublicEventChild(pathname)) return true;
  if (isPublicLegacyCampusClub(pathname)) return true;
  return false;
}

function isPublic(pathname) {
  return isPublicPath(pathname);
}

/**
 * The one-time-code step (and its route) was replaced by Google sign-in.
 *
 * Old links — emails, bookmarks, cached redirects — must land on the sign-in
 * screen, so this answers them with a real HTTP redirect before any session
 * work happens. (`app/login/verify/page.js` keeps a redirect of its own as a
 * fallback, but a Server Component redirect is delivered to the browser as a
 * streaming instruction, not as a status code; the proxy can send the 307.)
 */
function legacyCodeStep(request) {
  if (request.nextUrl.pathname !== '/login/verify') return null;
  const origin = originFromHeaders(request.headers, request.nextUrl.origin);
  const target = new URL('/login', origin);
  target.searchParams.set('notice', 'google');
  return NextResponse.redirect(target);
}

/**
 * Old explore-era URLs, kept alive as real HTTP redirects.
 *
 * The Explore page used to link to `/explore/team-finder` and the like; those
 * links were the root cause of "team finder opens the wrong page" (they 404'd
 * or fell through to another screen). The links themselves now point at the
 * canonical routes — `/campus/teams`, `/campus/lost-found` — and these
 * redirects rescue bookmarks and shares made along the way. Both spellings of
 * team finder are accepted because both circulated.
 */
const LEGACY_PATHS = {
  '/explore/team-finder': '/campus/teams',
  '/explore/teamfinder': '/campus/teams',
  '/explore/teams': '/campus/teams',
  '/explore/lost-found': '/campus/lost-found',
};

function legacyPathRedirect(request) {
  const { pathname, search } = request.nextUrl;
  const target = LEGACY_PATHS[pathname];
  if (!target) return null;
  const origin = originFromHeaders(request.headers, request.nextUrl.origin);
  const url = new URL(target, origin);
  url.search = search;
  return NextResponse.redirect(url);
}

/**
 * @param {import('next/server').NextRequest} request
 */
export async function proxy(request) {
  // Explicitly opted-in local demo: the preview host opens the sample instead
  // of the unconfigured app. Production and ordinary development are unchanged.
  if (process.env.NODE_ENV === 'development' && process.env.CAMPUS_ONBOARDING_DEMO === '1' && request.nextUrl.pathname === '/') {
    const origin = originFromHeaders(request.headers, request.nextUrl.origin);
    return NextResponse.redirect(new URL('/onboarding-preview', origin));
  }
  const legacy = legacyCodeStep(request) || legacyPathRedirect(request);
  if (legacy) return legacy;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Without configuration the app must still boot and explain what is missing
  // (spec §92) — never 500 the whole site because an env var is absent.
  if (!url || !key || /^YOUR_/.test(key)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims() verifies the JWT locally when possible and falls back to the
  // auth server only when the token must be refreshed. A failure here means the
  // session is gone, not that the request should fail.
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  } catch {
    signedIn = false;
  }

  const { pathname, search } = request.nextUrl;

  // Unknown paths must reach the App Router 404. Known protected routes still
  // redirect; the inventory is checked against the filesystem in tests.
  if (!signedIn && !isPublic(pathname) && isKnownRoute(pathname)) {
    const target = new URL('/login', request.url);
    if (pathname !== '/') target.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(target);
  }

  // Use an HTTP redirect before rendering on both entry URLs. The dashboard
  // performs the full account, onboarding and authorization checks.
  if (signedIn && (pathname === '/' || pathname === '/login')) {
    const redirect = NextResponse.redirect(new URL('/home', request.url));
    redirect.headers.set('Cache-Control', 'private, no-store, max-age=0');
    return redirect;
  }

  return response;
}

export const config = {
  // Everything except static assets, image optimisation, the favicon and API
  // route handlers (which authenticate themselves and return JSON, not HTML).
  matcher: ['/((?!_next/static|_next/image|api/|favicon.ico|robots.txt|manifest.webmanifest).*)'],
};
