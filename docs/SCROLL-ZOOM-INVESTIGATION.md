# Scrolling, Zooming and Full-Page Re-Rendering — Investigation

**Date:** 2026-11-28 · **Branch:** `arena/ca5ad93c-setup` · **Commit base:** `234609012ead9f3838ed7256ad3572320f39f333`
**Scope:** the report that "the entire application loads again whenever they scroll … or zoom", on desktop and mobile.
**Answer up front:** nothing in the shell, the chrome, the providers or any route reloads, remounts or globally re-renders on scroll or zoom. The one dominant, measurable full-screen cost is an infinitely animating ambient layer (`BackgroundBeams`), plus a large burst of intentional viewport `<Link>` prefetching during scroll. Both are design decisions, not defects; neither is removed in this change. Details and the one-line mitigations are below — they await a product decision.

## Environment and method

| Item | Value |
| --- | --- |
| Node | v22.22.3 (Node 24 requested; not available in the sandbox — `node@24` not cached) |
| Next.js | 16.4.6 · React 19 · Supabase JS |
| Backend | `scripts/dev/perf/serve.mjs` — disposable PostgreSQL + migrations + seeded fixtures, behind the PostgREST/Auth stub at `127.0.0.1:3111` (25 ms RTT per request) |
| App | production build (`npm run build`) served with `next start` on `127.0.0.1:3100` |
| Browser | `@sparticuz/chromium` (SwiftShader software GL — worst-case for paint, so treat Paint/Raster counts as directional) driven by Playwright; Chrome DevTools Protocol for CPU throttling, page-scale zoom, tracing and paint counts |
| Evidence classes | document/RSC/API request logs, DOM node identity sentinels, React DevTools commit counter (`__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`), PerformanceObserver (longtask, layout-shift), Chromium trace events (`devtools.timeline`) |

A note on honesty: with a GPU-composited browser the software-rendering numbers below shrink dramatically. The *relative* ordering of contributors is the finding, not the absolute counts.

## Phase 1 — what actually reloads (it doesn't)

On every probed route, scripted slow/fast scroll (±900 px) and CDP zoom (80/90/100/110/125/150 %):

- **Document navigations:** none on scroll/zoom. `performance.getEntriesByType('navigation')` reports a single `navigate` with `redirectCount: 0`. The second `framenavigated` event some pages show is Next's same-document `history.replaceState` at mount (verified by tracing `history.replaceState` — stack is Next's own chunk), not a reload.
- **router.refresh():** zero on scroll/zoom. (`LiveFeedSync` refreshes are feed-event driven and burst-throttled at 4 s for non-local reasons; local reasons apply at once by design and are pinned by `tests/feed-instant-update.test.js`.)
- **React commits:** ~+5 per full scroll pass on `/home`, ~+10 per zoom pass — feed-card visibility loads and route metadata, not the shell.
- **DOM identity:** `.side-panel`, `main#content`, `.background-beams` are the *same nodes* after scroll and after zoom on every route tested. Nothing detaches/reattaches; the intro `<section>` is the only node ever removed (intro completion, expected).
- **Long tasks:** +0 ms at 1× CPU during a scroll pass; **+1,349 ms (10 tasks) at 4× and +2,343 ms (17 tasks) at 6× CPU**, with **47 prefetch requests** fired by the same pass. Layout shift ≈ 0.018 total.
- **Paint/raster (software GL):** ~250 Paints / ~430 RasterTasks per scripted pass in steady state.

So: no document reload, no router-cache re-read, no global remount, no global re-render, no forced layout. What *is* true: the browser keeps **painting an always-on, non-compositable animated layer** (Phase 3) and keeps **fetching dozens of route prefetches while the reader scrolls** (Phase 4). On a low-end phone or a metered/slow link those two read exactly like "the application is loading itself again".

## Phase 2 — React lifecycle (clean)

- Root layout → `ThemeChrome` (effect-only), `BackgroundBeams` (static render), `LandingIntro` (route-gated, mounts only on `/home` entry) — no state on scroll/resize.
- Shared shell (`app/(shell)/layout.js` → `OptionalAppFrame` → `AppShell` → `ShellFrame`): `ShellFrame` registers exactly one `matchMedia('(max-width: 1023px)')` listener (change only on breakpoint crossing), an `Escape/Tab` handler only while the mobile sheet is open, and a pathname-keyed `content.animate()` (220 ms fade on navigation, cancelled on cleanup). No scroll listeners, no viewport-dimension-dependent state, no unstable keys, no `router.refresh()` in any listener (`components/navigation/NavigationHelp.js` and `components/ui/overlays.js` only reposition a portalled panel and only while open, with cleanup).
- Providers: `MessagingProvider` / `LiveFeedProvider` hold refs + minimal state, one Realtime channel each, fallback polling only while the channel is not live; `LiveFeedSync` (server-board bridge) is 4 s-throttled for external events and immediate for local ones (`IMMEDIATE_REASONS = ['local','reconcile','reconnect']`), pinned by tests; scroll never enters either path.
- Shell stays mounted: Verified node identity before/after scroll, zoom, theme switch, resize and form editing. Forms keep state across zoom/resize (6 fields on `/settings`; typed value identical after 150 % → 80 % page-scale round trip).
- Zoom ≥ breakpoint: at ≤1023 CSS px the `ShellFrame` matchMedia listener flips the rail to the hidden/bottom-nav chrome — by design. The sidebar host stays in the DOM (`hidden`), `main` identity is preserved, children do not remount. Crossing is reversible (768 → 1023 → 1280 restores the open rail with no state loss).
- Duplicate/extra observers: none found. `IntersectionObserver` usage is feed "show more" + lazy galleries, each disconnecting on settle. No `ResizeObserver` recreates WebGL; the login ghost scene resizes the renderer in place.

## Phase 3 — CSS / compositor (the real full-screen cost)

| Layer | Effect | Measured share (software GL, steady state) |
| --- | --- | --- |
| `.background-beams__trail` — 15 infinite `stroke-dashoffset` animations on a fixed, `slice`-scaled, masked 696×316 → viewport SVG | **Every frame re-rasterises the whole slice-scaled layer** (dash offset is not compositable) | **Paint 250→185 (−26%), RasterTask ~431→~108 (−75%) when the animation is stopped; identical when the whole layer is hidden** |
| `body::before` glass room (`glass-room-drift`, transform/opacity, `will-change: transform`) | composited; ~20% of paint in A/B (removing it saved ~23%) | kept |
| `body::after` grain (`mix-blend-mode` overlay/soft-light, full-viewport, fixed) | blend readback; ~23–25% paint saving if swapped to `normal`, ~24% if removed | kept — removing a designed material layer needs a product decision |
| 23 `backdrop-filter` surfaces | **not** the painter: removing them *increased* Paint 250→394 (+58%) and RasterTask →674 (+56%) | kept (glass is innocent) |
| `contain: strict` on `.background-beams` | no measurable effect (steady-state deltas inside noise) | rejected — no benefit, no point shipping it |
| Backdrop-filters, sticky/fixed chrome, gradients, night sky | `NightSky` component is mounted nowhere (dead code, pre-existing); night layers cost paint only under `data-theme=night` if mounted | kept / noted |

Conclusion: one ambient layer is re-rasterising the entire viewport forever, on every page, whether the user is scrolling or not. It does not unmount or remount anything; it is pure repaint throughput — and on mid/low-end GPUs it is the most plausible source of the "flicker/shimmer" and "everything redraws" feel. It is also why screenshots and video capture stutter.

**Not changed** — it is a deliberate ambience with a tested `prefers-reduced-motion` variant. Awaiting a go/no-go (see Recommendations).

## Phase 4 — Data fetching during scroll

Scrolling fires **Next.js viewport prefetches** for links that enter the view, each a full **dynamic** route render (`force-dynamic` pages → `requireUser()` + Supabase reads on the server) plus the route's JS/CSS chunks:

- Scripted 1,500 px pass on `/home`: **47 prefetches** (measured at 1×, 4× and 6× CPU). Sample targets: `/explore, /market, /gigs, /clubs, /communities, /campus, /map, /chat, /notifications, /campus/noticeboard(+3 details), /post/*, /campus/events/*, /user/meera_j`.
- A slower scroll triggers the same class of traffic (22–53 requests/pass observed).
- These are `next-router-prefetch: 1` requests; **none** is a document load and **none** re-renders the current route. Under 4–6× CPU throttling they still inflate main-thread work (Phase 1 long tasks).
- This behaviour is intentional and pinned: `tests/home-prefetch.test.js` requires non-Home prefetch to stay intact; the shared chrome (`Sidebar`, `BottomNav`, `Brand`) carvees out only `/home`. `LiveFeedProvider` Realtime reconnect/back-off and the 20 s gap-recovery tick are expected and not scroll-driven; `/api/messages/sync`, `/api/home/feed`, `/api/storage/*` counts unchanged by scroll.
- Verdict: prefetching is the app "loading the rest of itself" as you read — but switching it off is a product/navigation-UX trade, not a bug fix (instant routes vs. background cost). It needs your call (see Recommendations). `router.refresh()` misuse, polling loops, subscription storms — none found.

## Phase 5 — Route × viewport matrix (all 1280×800 unless noted)

| Route | Result |
| --- | --- |
| `/`, `/login` | both resolve (logged-in `/login` → `/home`); stable |
| `/home` | stable; sentinels identical across scroll/zoom/theme; 14 load commits |
| `/explore` | 1 extra same-document Next `replaceState` at mount (no document); stable |
| `/market`, `/gigs`, `/clubs`, `/communities`, `/campus`, `/timetable`, `/chat`, `/notifications`, `/settings` | stable; sentinels identical after scroll |
| Form state | `/settings` typed value survived 150 % → 80 % page-scale and resize sweep |
| Shell | `main` node identity identical after scroll · zoom · theme switch · resize |
| Breakpoint | 1280 → 1100 → 1024 → **1023** → 1000 → 900 → 768 → 1280: rail collapses ≤1023 px and returns 1280 px, `hidden` attr toggles, no remount, no data loss |
| 390×844, 844×390, 768×1024 | `main` stable; rail hidden; no horizontal document overflow |
| Not verified | physical mobile devices, real GPUs, Safari/Firefox paint paths; production RTT (Vercel↔Supabase) for prefetch latency |

## Recommendations (need a decision — none is in this PR)

1. **BackgroundBeams comets.** Highest-value, narrowest change available: gate `.background-beams__trail { animation: … }` behind `@media (prefers-reduced-motion: no-preference)` *as an opt-out default* (i.e. default off, opt-in on), or cap with `animation-play-state` tied to visibility, or replace with the already-designed static reduced-motion trails. Measured: −75% raster, −26% paint. This is the single change most likely to fix "the whole app redraws / flickers". It is an ambience decision, not a defect fix, so it is deliberately not made unilaterally.
2. **Viewport prefetch of dynamic routes.** Options: (a) keep as-is (current, pinned by tests); (b) `prefetch={false}` on feed/board content links only (post permalinks, rails), keeping chrome navigation instant; (c) leave global, rely on `loading.js` skeletons. Each is defensible; only you can pick the UX trade.
3. Consider dropping the never-mounted `NightSky` component/CSS or wiring it deliberately (pre-existing dead code, unrelated to this P0).

## Limitations

- Software-GL (SwiftShader) paint counts; relative deltas are the evidence, not absolute numbers.
- CDP `pageScaleFactor` does not re-layout like native browser zoom; the true breakpoint crossing was verified via viewport-width resize instead.
- Production latency, network, and cold-start behaviour not exercised (Vercel SSO); local RTT fixed at 25 ms.
- No human visual pass; "flicker" is inferred from paint traces, not direct observation.
- Node 22 used locally vs. the requested Node 24 (sandbox limitation).

## Files changed

`docs/SCROLL-ZOOM-INVESTIGATION.md` (this document) — no behavioural or styling changes.
