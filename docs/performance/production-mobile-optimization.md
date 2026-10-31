# Campus+ production mobile optimization

**Date:** 2026-10-31 (Asia/Calcutta; raw artifact timestamps are UTC)  
**Branch:** `arena/afd7e725-setup`  
**Baseline source:** merge commit `3b7124727769a7e7cbd104f84143d71daa72a634`  
**Final status:** implementation and local verification complete; not merged or deployed, and no new production RES/field result exists.

This is an implementation report, not a prediction of a Vercel Real Experience Score. Lab results below are diagnostic evidence from a local production build. Only a later, normally authorized deployment with enough real mobile visits can establish a new production RES or field P75.

## 1. Supplied production baseline and targets

The supplied Vercel **Production Mobile, seven-day** baseline is **RES 57/100 from 267 events**.

| Route | Events | RES |
| --- | ---: | ---: |
| `/timetable/[division]` | 104 | 55 |
| `/home` | 55 | 55 |
| `/` | 13 | 50 |
| `/explore` | 3 | 53 |
| `/login` | 48 | 99 |
| `/timetable` | 2 | 96 |
| `/onboarding` | 8 | 100 |
| `/guide` | 4 | 100 |

The listed route counts total 237, not the overall 267; no assumption is made about the unlisted remainder. No route-level FCP, LCP, INP, CLS, TTFB, device, connection, or P75 distribution was supplied. In particular, this report does **not** invent those values, use deprecated FID as INP, or infer that loading is the only cause of RES 55.

Targets remain real-mobile **P75 FCP ≤ 1.8 s, LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1**, with TTFB aiming for **≤ 800 ms**. The initial field goal is **RES > 75**, then **> 90** over a longer comparable period. Division timetable and Home have priority because they combine low RES with 159 of the 237 listed route events. Explore is investigated but its three-event sample does not justify risky work. Healthy routes are controls, not rewrite candidates.

## 2. Evidence rules and measurement environment

### Field versus lab

- The table above is the only production field evidence available in this session.
- There is no Vercel dashboard, production Supabase, physical phone, or real-user metric access here.
- Browser numbers below come from Chromium 153 against `next start`; they are not Vercel values and cannot be converted into RES.
- Cold and repeat visits are separate. Medians retain spreads and all attempts. Missing measurements stay `null`, never zero.
- `labInteractionMs` is the maximum Event Timing duration from a scripted, non-destructive action. It includes input delay, processing, and next-paint delay, but a few synthetic actions are **not field INP**.
- The fixture has no real Realtime WebSocket. Its expected `404` console messages do not test or invalidate hosted Realtime behavior.

### Locked local configuration

- Next **16.3.8**, React/React DOM **19.3.0**, Node **22.22.3** from the lockfile installation. An earlier no-save tooling install selected newer versions and was discarded with `npm ci` before any baseline build.
- Production build generated successfully: 87 static-generation steps, 18 prerendered public timetable API variants, and the existing timetable service-worker bundle check.
- Disposable PostgreSQL **17.10**, all **37 migrations**, deterministic fixtures: **12 accounts, 8 communities, 240 posts, 420 messages, 143 notifications**.
- Supabase stub RTT: **25 ms per upstream request**. This is a controlled server diagnostic, not a hosted latency model.
- Slow-4G profile: **150 ms latency, 1.6 Mbit/s down, 750 kbit/s up, 4× CPU slowdown**. DPR 3 Android-style touch contexts.
- Required phone matrix: **360×800, 375×812, 390×844, 412×915**. Existing historical viewport sets remain available.
- The repeat harness disables HTTP cache for the cold document, then opens a new document in the same context with cache enabled for repeat. JavaScript heap/memory is not carried between those documents.
- Home's standard matrix dismisses the intro through its real **Skip intro** button. A separate untouched `--keep-intro` run prevents that convenience from hiding the intro's own LCP.

### Raw baseline artifacts

All paths are relative to `perf-results/`; console logs are under `perf-results/logs/` with matching names.

| Evidence | Artifact |
| --- | --- |
| Home server render/upstream traces | `production-mobile-before-server-home.json` |
| Explore server render/upstream traces | `production-mobile-before-server-explore.json` |
| Division server render, zero upstream queries | `production-mobile-before-server-division.json` |
| Seven-route cold/repeat Slow-4G matrix, three runs | `production-mobile-before-repeat-slow4g.json` |
| Four-width, fast/Slow-4G Home and division matrix, three runs | `production-mobile-before-phones.json` |
| Untouched Home intro, three cold/repeat runs | `production-mobile-before-home-intro-slow4g.json` |
| Corrected division Tuesday interaction probe | `production-mobile-before-division-interaction-slow4g.json` |
| Home CSS-fallback/no-WebGL diagnostic | `production-mobile-before-home-no-webgl-slow4g.json` |
| Home layout-shift rectangles/API timing | `production-mobile-before-home-cls-diagnostic.json` |
| First failing division click and modal diagnosis | `logs/production-mobile-before-division-click-diagnostic.log` |

The original seven-route artifact retains a failed timetable click probe. It failed because the proactive install sheet covered the control; it is not reported as an INP measurement. The separate corrected division artifact dismisses that sheet outside the measured Tuesday-tap window and records its presence.

## 3. Architecture findings before changes

### Home

- `app/(app)/home/page.js` is an authenticated server-rendered personalized shell. It deliberately does not wait for feed/rail queries.
- `HomeFeedClient` loads `/api/home/feed` after hydration with `cache: 'no-store'`, then owns pagination, live reconciliation, and a bounded per-user in-memory return cache. This architecture and its deletion/moderation rules are preserved constraints, not a reason to put personalized data in a shared cache or Web Storage.
- `GalacticIntro` is gated to direct `/`/`/home` entry. It can wait up to 3 seconds for two font faces, then runs a 5.65-second sequence; the application content is inert while visible.
- `DepthField` dynamically imports the Three scene, but does so **before** checking WebGL. The scene's first draw compiles shaders synchronously. Its existing CSS composition is a complete visual fallback.
- Home preloads the intro-only Syne and Space Grotesk variable fonts. Other routes no longer prefetch them; that prior optimization must not be regressed.

### Division timetable and timetable index

- The division page is public, server-rendered, resolves its initial day with `Asia/Kolkata`, and passes the live day plus a closed full-week reference into client/provider boundaries. It needs no Supabase read.
- `TimetableLive` already owns one one-second clock interval, derives NOW/NEXT correctly, and auto-scrolls only once when needed. No evidence yet justifies rewriting that logic or memoizing every row.
- `TimetableOfflineProvider` reads device state, registers the scoped worker, and refreshes saved snapshots without overwriting a good copy after failure.
- On a visitor with no saved copy, `refresh()` still fetches and validates the snapshot before reaching its `skipped: 'not-saved'` return. There is no copy to update in that case.
- On a fresh mobile device, `installOfferDecision()` proactively opens the install sheet even with `savedReady: false`. The sheet covers the day tabs until **Not now** is chosen. Manual save/install remains available in the header pill and the card below the timetable.
- `/timetable` is a lightweight static public index. Its healthy RES and low event count do not justify changes.

### Root, Explore, and healthy controls

- `/` is only an authentication/onboarding/Home redirect. It is not a marketing page. Signed-out browser runs finish on `/login`; no landing-page rewrite is appropriate.
- Explore is a server-rendered directory with one `trending_posts` RPC and client search. It is not an unbounded feed. The RPC is the slowest local upstream read, but three production events and prior rejected slower SQL alternatives mean no query change is justified by this task's current evidence.
- `/login`, `/timetable`, `/onboarding`, and `/guide` are healthy in the supplied field sample. Onboarding cannot be measured honestly with the seeded completed profile because it redirects to Home; it is not mislabeled as such in the harness.

## 4. Baseline results and accepted root causes

### Server render/upstream work (five runs, median)

| Route | Header TTFB | Complete HTML | HTML bytes | Upstream reads | Finding |
| --- | ---: | ---: | ---: | ---: | --- |
| `/home` | 19 ms | 128 ms | 78.6 kB | 4 | Shell streams before feed; auth/profile plus notification/messaging counts. |
| `/explore` | 15 ms | 326 ms | 87.6 kB | 5 | `trending_posts` 232 ms in the final trace; investigate, do not churn. |
| `/timetable/a` | 16 ms | 20 ms | 70.1 kB | 0 | Backend is not the local division bottleneck. |

Header TTFB and complete-body time are deliberately separate; streamed HTML makes them different measurements.

### Slow-4G 390×844 cold/repeat browser medians (three runs)

These are from the standard matrix, which skips Home's intro as a student can.

| Route | Visit | FCP | LCP | CLS | Transfer | Lab interaction |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `/` → `/login` | cold | 1,184 ms | 1,184 ms | 0 | 561.3 kB | n/m |
| `/` → `/login` | repeat | 296 ms | 296 ms | 0 | 13.3 kB | n/m |
| `/home` | cold | 1,376 ms | 3,224 ms | 0.0905 | 683.6 kB | 136 ms |
| `/home` | repeat | 720 ms | 720 ms | **0.2574** | 50.4 kB | 120 ms |
| `/timetable/a` | cold | 1,104 ms | 1,116 ms | 0 | 318.0 kB | see corrected probe |
| `/timetable/a` | repeat | 320 ms | 372 ms | 0 | 19.1 kB | see corrected probe |
| `/explore` | cold | 976 ms | 976 ms | 0.0096 | 382.2 kB | 64 ms |
| `/explore` | repeat | 424 ms | 424 ms | 0.0096 | 28.5 kB | 72 ms |
| `/login` | cold | 1,184 ms | 1,184 ms | 0 | 453.5 kB | n/m |
| `/timetable` | cold | 1,072 ms | 1,072 ms | 0 | 263.5 kB | n/m |
| `/guide` | cold | 984 ms | 1,400 ms | 0 | 277.1 kB | n/m |

`n/m` means no applicable scripted interaction was measured, not zero latency. Explore's action typed `robotics` and exercised its real debounced search.

The corrected division probe measured Tuesday selection at **112 ms cold** (spread 72–136 ms) and **40 ms repeat** (spread 40–48 ms). The proactive install sheet appeared on every fresh cold context and on none of the repeat contexts after dismissal. Thus current synthetic Tuesday responsiveness is already below 200 ms; the first-use obstruction and unnecessary unsaved snapshot request are the supported timetable targets, not speculative row memoization.

### Required phone matrix

All **48 attempts** (2 routes × 4 widths × 2 profiles × 3 runs) completed with **zero horizontal overflow**. Slow-4G medians:

| Route | 360×800 FCP/LCP/CLS | 375×812 FCP/LCP/CLS | 390×844 FCP/LCP/CLS | 412×915 FCP/LCP/CLS |
| --- | --- | --- | --- | --- |
| Home | 1,680 / 1,996 ms / 0.0955 | 1,372 / 2,960 ms / 0.0941 | 1,360 / 2,904 ms / 0.0905 | 1,360 / 1,360 ms / 0.0842 |
| Division | 992 / 1,404 ms / 0 | 996 / 1,424 ms / 0 | 992 / 1,408 ms / 0 | 1,016 / 1,412 ms / 0 |

The spread across Home LCP and the different LCP elements in skipped-intro runs are reasons not to cherry-pick the 360 or 412 result. The untouched run is the cleaner intro diagnosis.

### Accepted implementation hypotheses

1. **Home LCP includes a real intro/font cost.** In all six untouched cold/repeat documents, the recorded LCP element was the intro's SVG **CAMPUS** text. Cold untouched LCP was 3,032–3,652 ms. The two intro fonts alone transferred **76,771 B (Syne) + 65,121 B (Space Grotesk) = 141,892 B** on every cold run, despite a very small rendered glyph set. Subsetting those exact existing faces while preserving variable weight axes is a byte/waterfall fix, not a content removal.
2. **Decorative WebGL competes with the mobile page.** Home's cold standard run had 9,227 ms total long-task time. The controlled no-WebGL/CSS-fallback diagnostic had 1,287 ms with essentially unchanged transfer (the dynamic module still downloaded). The large task therefore belongs to the sandbox's software GL/shader path, not ordinary feed React work. This does not predict equal hardware-phone milliseconds. It does justify checking capability before import and avoiding or deferring decorative GPU startup on constrained mobile paths while retaining the designed CSS atmosphere.
3. **Home repeat CLS is not finished.** Repeat CLS was 0.2574, above target. Shift rectangles and API timing show that not every shift coincides with the feed response, so blindly increasing skeleton heights or blaming only stats would be unsupported. Re-measure after the intro/atmosphere slice before choosing a layout edit.
4. **The proactive timetable sheet blocks first use.** A real click diagnostic found `P.tt-offer__status` and the modal scrim above the Tuesday button. Requiring an actually saved copy before the unsolicited offer would match the provider's stated save-then-install contract while retaining manual save, offline, native install, instructions, dismissal, and update flows.
5. **Unsaved timetable visits make a request with no possible persistence.** Skipping only that automatic refresh for `savedRef.current === false` avoids transfer and work without changing saved-copy freshness. Explicit **Save** must still fetch, validate, and persist; saved copies must still refresh and keep their last good copy on failure.

### Rejected or deferred guesses

- No root marketing page, shared personalized server cache, private Web Storage, RLS/policy relaxation, service-role browser credential, or speculative database migration/index.
- No Explore SQL rewrite from a three-event field sample.
- No blanket `memo`, lazy loading, preloading, timetable rewrite, healthy-route rewrite, or removal of feed/realtime/offline features.
- No claim that the local software-WebGL task duration is a physical-device measurement.
- No production RES prediction from any result above.

## 5. Implemented changes

The investigation report above was written before product edits. The implementation stayed scoped to the measured Home and division paths; healthy routes and the authorized feed pipeline were not rewritten.

### 5.1 Division timetable: remove work that cannot benefit the device

- `components/timetable/TimetableOfflineProvider.js` now returns `skipped: 'not-saved'` **before** the automatic fetch when no saved copy exists. Explicit **Save** still fetches, validates, and persists. Saved copies still auto-refresh, compare checksums, and retain the last good copy after failure.
- `lib/timetable/offline-install.js` requires a ready saved copy before an unsolicited install offer. A fresh visitor can read and change days immediately; manual save/install, native `beforeinstallprompt`, instructions, dismissal cooldown, and update flows remain.
- No clock, `Asia/Kolkata` day selection, current/next-class calculation, division selection, row rendering, service-worker cache policy, or schema was changed.
- Coverage was updated in `tests/timetable-install-plumbing.test.js`, `tests/timetable-offline-ui.test.js`, and `scripts/dev/timetable-offline-check.mjs`. The browser test was corrected to the actual save-first UI contract; superseded failing test-contract runs are retained rather than hidden.

### 5.2 Home atmosphere: avoid decorative mobile GPU startup

- `components/atmosphere/DepthField.js` keeps the finished CSS composition as its SSR/loading/failure surface. Reduced-motion, coarse-pointer, narrow-screen, and data-saving visits use that composition without importing Three.
- Capable desktops retain the dynamically imported scene. WebGL capability is checked **before** import; import failure, shader failure, and context loss still dispose the canvas and reveal the CSS composition.
- This is a device/capability policy, not a claim that the sandbox's software-GL milliseconds equal a physical phone. No content or feed feature was removed.
- `tests/depth-field.test.js` covers the pure policy and source-level pre-import/fallback contract.

### 5.3 Intro fonts and compact phone choreography

- `public/fonts/Syne.ttf` and `public/fonts/SpaceGrotesk.ttf` were subsetted **in place** to the glyphs the existing intro actually paints, preserving their variable weight axes and adjacent OFL licenses. FontTools was isolated under `/tmp`; no runtime or project dependency was added.
- `components/layout/GalacticIntro.js` and `GalacticIntro.module.css` add a compact phone sequence while retaining the same wordmark, tagline, Skip control, reduced-motion behavior, bounded font wait, and independent safety deadlines. Desktop choreography is unchanged.
- Home remains the only route that preloads these faces. `tests/intro.test.js` covers the phone policy and font/safety contracts.
- The compact sequence did **not** produce a reliable untouched-intro LCP improvement in the diagnostic runs. It is therefore not reported as an LCP win; the defensible byte result is below.

| Font | Raw file before → after | Cold compressed transfer before → after |
| --- | ---: | ---: |
| Syne | 146,980 → 54,972 B | 76,771 → 33,289 B |
| Space Grotesk | 136,676 → 50,168 B | 65,121 → 23,660 B |
| **Total intro faces** | **283,656 → 105,140 B (−62.9%)** | **141,892 → 56,949 B (−59.9%)** |

### 5.4 Home guide offer: reserve or suppress before first paint

The remaining repeat-Home shift was attributed to the guide offer being inserted above already-painted content after hydration. A mirrored cookie/server preference was rejected because this is intentionally a per-device flag, not account data.

- `app/(app)/home/page.js` now emits `GuideWelcomeStrip` in Home's first HTML. A tiny static pre-paint script hides that reserved node only when the existing local guide-seen flag is present; hydration then removes it normally.
- `components/guide/GuideWelcomeStrip.js` uses `useSyncExternalStore` with matching server/first-hydration output. New devices see the offer without a post-paint insertion; returning devices do not paint and then remove it. Blocked storage retains the honest “for now” behavior.
- `lib/guide/first-visit.js` owns the static script and existing legacy-value rules. It stores no private data and adds no server preference or migration.
- The offer and `app/styles/guide-strip.css` are scoped to Home through `app/(app)/home/layout.js`; their shared AppShell/root-layout ownership was removed. Other routes do not download or execute this helper.
- `tests/guide.test.js` covers SSR, pre-hydration suppression, legacy values, blocked storage, and route scoping.

The final returning-device browser diagnostic confirmed: initial strip `display: none`, final strip count zero, one Home script, no guide element in shift attribution, no helper on signed-out Login or Explore, and no page errors. Raw: `production-mobile-final-guide-prehydration.json`.

### 5.5 Feed, Explore, backend, and security boundaries deliberately unchanged

`HomeFeedClient`, `/api/home/feed`, and `LiveFeedProvider` were inspected and exercised, but no speculative feed rewrite was made. The bounded ten-entry per-user in-memory cache, no-store authorized reads, pagination, stable append order, publication checks, authorized revalidation, moderated/hidden deletion, and reconnect cleanup remain intact. Page absence is still not treated as deletion, and a realtime event alone still cannot render unauthorized content.

Explore's `trending_posts` RPC was the slowest local upstream read, but the three-event production sample and lack of a demonstrated better query did not justify SQL churn. No shared personalized server cache, private Web Storage, new index/migration, RLS relaxation, public private-table exposure, browser service-role credential, or blanket memo/lazy/preload change was introduced.

### 5.6 Measurement and audit tooling

- `scripts/dev/perf/mobile.mjs` adds the required four-width set and comparable mobile diagnostics; `repeat.mjs` separates cold/repeat documents and records FCP, LCP, CLS, TTFB, transfer/fonts, long tasks, route completion, and Event Timing without calling synthetic duration INP.
- `scripts/dev/timetable-offline-check.mjs` exercises the real save-first DOM rather than assuming an install sheet opens immediately after Save.
- `scripts/dev/contrast/audit.mjs` now uses an exact CTA locator so the Clubs tile cannot cause a strict-mode collision.
- `scripts/dev/contrast/rendered.mjs` now measures each actual SVG gradient stop against the same captured background. Its canvas parser is reset before every color, preventing an unsupported `url(#gradient)` paint from reusing the previous icon's color. This fixed the audit artifact; it did not hide the icon or change product contrast.

No dependency manifest or lockfile changed.

## 6. Final before/after results

All final comparisons use the same locked production-build fixture, route set, 390×844 DPR-3 touch context, Slow-4G/4×-CPU profile, and three-run median method as the baseline. The final artifacts are `production-mobile-final-repeat-slow4g.{json,txt}` and `production-mobile-final-phones.{json,txt}`. Intermediate `slice1`, `slice2`, and `after` artifacts are retained but are not represented as final-application results.

### 6.1 Seven-route cold/repeat matrix

Each cell is **baseline → final**. `n/m` means no applicable scripted action, never zero. These are lab medians, not field P75.

| Route / visit | FCP | LCP | CLS | Navigation TTFB |
| --- | ---: | ---: | ---: | ---: |
| `/` → Login, cold | 1,184 → 1,180 ms | 1,184 → 1,180 ms | 0 → 0 | 26 → 32 ms |
| `/` → Login, repeat | 296 → 280 ms | 296 → 280 ms | 0 → 0 | 17 → 23 ms |
| `/home`, cold | 1,376 → **1,328 ms** | 3,224 → **1,328 ms** | 0.0905 → **0.0314** | 16 → 17 ms |
| `/home`, repeat | 720 → 724 ms | 720 → 724 ms | **0.2574 → 0** | 14 → 18 ms |
| `/timetable/a`, cold | 1,104 → **996 ms** | 1,116 → **1,412 ms** | 0 → 0 | 19 → 22 ms |
| `/timetable/a`, repeat | 320 → 392 ms | 372 → 392 ms | 0 → 0 | 119 → 128 ms |
| `/explore`, cold | 976 → 1,012 ms | 976 → 1,012 ms | 0.0096 → 0.0096 | 16 → 17 ms |
| `/explore`, repeat | 424 → 472 ms | 424 → 472 ms | 0.0096 → 0.0096 | 20 → 13 ms |
| `/login`, cold | 1,184 → 1,184 ms | 1,184 → 1,184 ms | 0 → 0 | 12 → 14 ms |
| `/login`, repeat | 344 → 348 ms | 344 → 348 ms | 0 → 0 | 13 → 17 ms |
| `/timetable`, cold | 1,072 → 1,076 ms | 1,072 → 1,076 ms | 0 → 0 | 8 → 8 ms |
| `/timetable`, repeat | 332 → 340 ms | 332 → 340 ms | 0 → 0 | 7 → 5 ms |
| `/guide`, cold | 984 → 988 ms | 1,400 → 1,424 ms | 0 → 0 | 20 → 18 ms |
| `/guide`, repeat | 396 → 400 ms | 396 → 432 ms | 0 → 0 | 18 → 15 ms |

Healthy-control movement is small but not uniformly positive; it is retained rather than hidden. Local TTFB is far below the field target because the server and stub are local, so it does not establish production TTFB ≤800 ms. The seeded completed profile cannot measure Onboarding without redirecting; it was not mislabeled as a successful Onboarding run.

### 6.2 Transfer, main-thread work, and interaction diagnostics

| Measurement | Baseline | Final | Interpretation |
| --- | ---: | ---: | --- |
| Home cold total transfer | 700,036 B | **486,835 B** | −30.5%; font and decorative-scene waterfall reduction. |
| Home repeat total transfer | 51,656 B | **46,128 B** | −10.7%; no feed caching contract changed. |
| Home cold long-task time | 9,227 ms | **1,096 ms** | Large local reduction; software GL is not a hardware-phone prediction. |
| Home repeat long-task time | 3,349 ms | **1,156 ms** | Retained improvement in the comparable run. |
| Division cold total transfer | 325,588 B | **313,455 B** | Unsolicited unsaved snapshot removed. |
| Division repeat total transfer | 19,569 B | **7,316 B** | No fresh-context snapshot fetch; saved-copy refresh is separately tested. |
| Division Tuesday, cold | 112 ms | **48 ms** | Corrected probes; install-sheet setup is outside the measured tap. |
| Division Tuesday, repeat | 40 ms | **40 ms** | No regression in this scripted action. |
| Home Discussion tab, cold | 136 ms | **472 ms** | **Regression**, spread 264–488 ms; input delay 34 ms and processing 16 ms in the final median. |
| Home Discussion tab, repeat | 120 ms | **120 ms** | No median change, spread 96–152 ms. |
| Explore search, cold / repeat | 64 / 72 ms | **72 / 72 ms** | No material median regression. |

The cold Home interaction regression is unresolved and is not explained away by the long-task improvement. Event Timing includes presentation delay; one synthetic composer-tab action is not INP. No speculative composer/aurora rewrite was added without a reproducible root cause. This needs physical-device and field interaction data.

### 6.3 Required phone matrix

All final **48 attempts** completed, with **zero horizontal overflow** at every route/width/profile combination. Slow-4G cells show **baseline FCP/LCP → final FCP/LCP**, then CLS baseline → final.

| Route | Width | FCP / LCP | CLS |
| --- | ---: | ---: | ---: |
| Home | 360×800 | 1,680/1,996 → **1,336/1,336 ms** | 0.0955 → **0.0332** |
| Home | 375×812 | 1,372/2,960 → **1,312/1,556 ms** | 0.0941 → **0.0326** |
| Home | 390×844 | 1,360/2,904 → **1,360/1,360 ms** | 0.0905 → **0.0314** |
| Home | 412×915 | 1,360/1,360 → **1,324/1,324 ms** | 0.0842 → **0.0842** |
| Division | 360×800 | 992/1,404 → **996/1,412 ms** | 0 → 0 |
| Division | 375×812 | 996/1,424 → **1,116/1,132 ms** | 0 → 0 |
| Division | 390×844 | 992/1,408 → **1,100/1,124 ms** | 0 → 0 |
| Division | 412×915 | 1,016/1,412 → **1,016/1,440 ms** | 0 → 0 |

Final unthrottled Home LCP medians at those widths were **268/116/140/112 ms**; division medians were **212/144/180/140 ms**. These are useful regression checks, not mobile-network claims.

Division LCP movement is mixed: two widths improve, two slightly regress, and the seven-route cold median regresses. The supported timetable claims are therefore **less unsolicited work, no first-use modal obstruction, preserved offline behavior, and improved Tuesday interaction**, not a consistent LCP gain.

The 412-pixel Home CLS median remains 0.0842. A separate returning-guide diagnostic recorded 0.0905102 total CLS from the aurora and a composer/feature node, not the already-hidden guide. It is below 0.1 but remains a residual risk; no arbitrary fixed-height patch was applied.

## 7. Final verification

| Check | Final result | Raw evidence |
| --- | --- | --- |
| Production build | **Passed**; 87 static-generation steps, existing SW bundle check | `production-mobile-final-build.txt` |
| ESLint, changed-script syntax, `sw:check`, `git diff --check` | **Passed**; generated timetable worker current (15.2 kB) | `production-mobile-final-lint.txt` |
| Unit suite | **77 files / 944 tests passed** | `production-mobile-final-unit.txt` |
| Migrations and SQL contract suites in broad verify chain | **37 migrations applied; 18 SQL suites passed** before the audit stage stopped the chain | `production-mobile-final-verify.txt` |
| Database security audit | **67 passed / 3 failed** on existing club-trigger PUBLIC execute grants and missing `club_creation_requests` backup catalogue/capture trigger; no SQL in this diff | `production-mobile-final-verify.txt` |
| Standalone security verification | Anonymous denials and built-browser secret scan **passed**; exits 1 solely on the documented deliberate fixture-placeholder hygiene grep | `production-mobile-final-security-harness.txt` |
| Home feed workflow | **14/15 passed**; only the idle no-polling assertion failed | `production-mobile-final-feed.txt` |
| Feed pagination/order/stability | **11/11 passed**; 10→20→30 entries, bounded reads, stable order, new head retained loaded tail | `production-mobile-final-pagination.txt`, `production-mobile-final-pagination-report.json` |
| Timetable offline/install/worker | **98/98 passed**, including radio-off reload/cold start, division isolation, save-first offers, native/manual flows, dismissal, and worker security | `production-mobile-final-offline.txt` |
| Mobile fit/disclosures/console/viewport | **366/366 passed**, including timetable horizontal scrolling/sticky Day and zoomable metadata | `production-mobile-final-viewport.txt`, `production-mobile-final-viewport-report.json` |
| Full contrast/accessibility paint audit | **0 failures**: 101 page audits, 285 paint audits, 22,122 foreground samples (15,252 text; 6,870 icon), 29 focus states, 2 intro layouts | `production-mobile-final-contrast.txt`, `production-mobile-final-contrast-report.json` |

Expected negative-path error logs in the unit output are test fixtures, not suppressed application errors. The initial contrast Chromium shared-library launch failure and the pre-parser report are also retained (`production-mobile-final-contrast-environment.txt`, `production-mobile-final-contrast-pre-parser-*`). The final audit used the already-unpacked NSS/SwiftShader libraries; no product code or audit threshold was weakened.

### Feed workflow limitation, explicitly not green

The feed run observed **two authorized feed reads during 24 idle seconds** in the no-WebSocket fixture. `LiveFeedProvider` intentionally performs 20-second gap recovery while the channel is not live and also checks on visibility restoration; the test brings the page to front. This is why viewer convergence and moderation checks pass on the degraded path. The fallback was not removed, the assertion was not relaxed, and the suite is not described as fully passing. Hosted Realtime remains unproven locally; its fixture WebSocket 404s are expected.

The three database-audit findings and the placeholder hygiene grep are existing repository/harness issues outside this performance diff. They remain visible release-review items rather than being silently “fixed” with destructive SQL or placeholder test changes.

One additional disposable-fixture limit appeared in the production-server log: Settings → Blocked embeds `profiles` through `blocks_blocked_id_fkey`, which the stub could not resolve (`PGRST100`), producing a 500 on that audit route. The product query was not changed and hosted Supabase was unavailable. Thus the contrast audit is evidence about the pixels it audited, not proof that the hosted blocked-list data query succeeded; this route needs a normal post-deployment smoke test along with the block/mute controls.

## 8. Changed-file inventory

| Area | Files |
| --- | --- |
| Home SSR guide and route scoping | `app/(app)/home/page.js`, `app/(app)/home/layout.js`, `app/(app)/layout.js`, `components/layout/AppShell.js`, `components/guide/GuideWelcomeStrip.js`, `lib/guide/first-visit.js`, `app/styles/guide-strip.css` |
| Home atmosphere and intro | `components/atmosphere/DepthField.js`, `components/layout/GalacticIntro.js`, `components/layout/GalacticIntro.module.css` |
| Timetable save-first behavior | `components/timetable/TimetableOfflineProvider.js`, `lib/timetable/offline-install.js` |
| Existing font assets | `public/fonts/Syne.ttf`, `public/fonts/SpaceGrotesk.ttf` |
| Browser/performance/contrast harnesses | `scripts/dev/perf/mobile.mjs`, `scripts/dev/perf/repeat.mjs`, `scripts/dev/timetable-offline-check.mjs`, `scripts/dev/contrast/audit.mjs`, `scripts/dev/contrast/rendered.mjs` |
| Tests | `tests/depth-field.test.js`, `tests/guide.test.js`, `tests/intro.test.js`, `tests/timetable-install-plumbing.test.js`, `tests/timetable-offline-ui.test.js` |
| This report and raw evidence | `docs/performance/production-mobile-optimization.md`, `perf-results/production-mobile-*` |

## 9. Deployment status and exact next field-measurement procedure

**Nothing was merged, deployed, or applied to production. No migration is required by this diff.** Production remains at the supplied RES baseline until an authorized normal deployment and sufficient real traffic exist.

1. Review the complete diff and raw artifacts, including the failed feed assertion, three database-audit findings, placeholder hygiene grep, mixed division LCP, and cold Home interaction regression. Do not describe the branch as all-checks-green.
2. After explicit authorization, deploy this exact reviewed revision through the ordinary Vercel process. Run no performance-related database migration because none exists. Do not disable RLS, change OAuth/email restrictions, or add browser credentials during deployment.
3. Record the deployment commit/id, authorized deployment timestamp, and the time all production traffic is on that revision. Smoke-test institutional OAuth, Home feed/pagination/moderation, Settings → Blocked plus block/mute behavior, saved-division refresh, genuine offline reload, and service-worker update without deleting visitors' saved copies.
4. In Vercel Speed Insights select **Production → Mobile → seven days**. Start the comparison window only after the new revision is fully serving; use the first complete seven-day period containing that revision, not a mixed old/new deployment window. Keep the same Production/Mobile filters and full seven-day duration as the supplied baseline.
5. Do not filter to fast devices, particular networks, geography, or only successful interactions for the headline comparison. If Vercel provides segments, record them separately to explain traffic-mix changes; do not substitute a favorable segment for the overall result.
6. Export or screenshot the overall result and every route row. Record **event count, RES, and actual available P75 FCP, LCP, INP, CLS, and TTFB** for `/timetable/[division]`, `/home`, `/`, `/explore`, `/login`, `/timetable`, `/onboarding`, `/guide`, and any routes needed to reconcile the overall event total. Use INP, never deprecated FID. Missing/insufficient values stay blank or `n/a`, not zero.
7. Compare against the supplied **57/100 from 267 events** and the route table in §1. Prioritize division and Home, but report sample sizes and traffic composition. Explore's prior three events and Timetable's two are not enough for strong route conclusions; apply the same caution to any low-volume new window.
8. Judge field targets only from that real-user P75 window: **FCP ≤1.8 s, LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1**, TTFB aiming **≤800 ms**, initial **RES >75**, then longer-term **>90**. Lab results in this report cannot establish or predict any of those production outcomes.
9. Save the new raw export/screenshots with the deployment id and window dates, and append the observed—not estimated—comparison here. If the window has insufficient events or mixed deployments, say so and wait for another comparable normal-traffic period rather than manufacturing a score.

## 10. Bottom line

The implementation removes an unnecessary unsaved timetable snapshot and first-use obstruction, avoids decorative mobile WebGL startup, reduces intro font bytes by 59.9% on the wire, and removes the measured returning-guide layout insertion. Final local evidence shows substantially lower Home transfer/long-task time, repeat Home CLS 0, preserved pagination/offline/security behavior, and clean mobile-fit and contrast audits. It also shows mixed division LCP and a cold Home synthetic-interaction regression. Those limitations, the non-green feed assertion, and existing repository audit findings remain part of the result. **No new production RES is claimed.**
