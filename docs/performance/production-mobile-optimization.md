# Campus+ production mobile optimization

**Date:** 2026-10-31 (Asia/Calcutta; raw artifact timestamps are UTC)  
**Branch:** `arena/afd7e725-setup`  
**Baseline source:** merge commit `3b7124727769a7e7cbd104f84143d71daa72a634`  
**Final status:** implementation and regenerated local verification complete; ready for review with the explicit findings in §17. Not merged or deployed; no new production RES/field result exists.

This is an implementation report, not a prediction of a Vercel Real Experience Score. Lab results below are diagnostic evidence from a local production build. Only a later, normally authorized deployment with enough real mobile visits can establish a new production RES or field P75.

**Current-tree authority:** §§1–10 retain the original investigation and first optimization run. §§11–17 contain the current follow-up implementation and regenerated evidence.

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

The initial implementation removed unnecessary timetable work, decorative mobile WebGL startup, intro-font bytes, and the returning-guide insertion. The follow-up below resolves its division and Discussion regressions, completes poll voting, and reruns the affected workflows. Historical failures remain in the raw evidence. **No new production RES is claimed.**

## 11. Current matched mobile results

The regenerated comparison uses the same three cold/repeat visits, 390×844 DPR-3 touch context, Slow-4G/4×-CPU profile, fixtures, and seven routes. Public paths explicitly include `/`; the older `production-mobile-followup-final-slow4g` root row is not comparable. Raw: `production-mobile-followup-final-matched-slow4g.{json,txt}`.

LCP cells are **original baseline → initial final → current**, in milliseconds.

| Route | Cold LCP | Repeat LCP | Current cold/repeat CLS |
| --- | ---: | ---: | ---: |
| `/` → Login | 1,184 → 1,180 → **1,336** | 296 → 280 → **508** | 0 / 0 |
| `/home` | 3,224 → 1,328 → **1,552** | 720 → 724 → **644** | 0 / 0 |
| `/timetable/a` | 1,116 → 1,412 → **1,072** | 372 → 392 → **304** | 0 / 0 |
| `/explore` | 976 → 1,012 → **1,092** | 424 → 472 → **444** | 0.0096 / 0.0096 |
| `/login` | 1,184 → 1,184 → **1,180** | 344 → 348 → **340** | 0 / 0 |
| `/timetable` | 1,072 → 1,076 → **1,068** | 332 → 340 → **340** | 0 / 0 |
| `/guide` | 1,400 → 1,424 → **1,112** | 396 → 432 → **384** | 0 / 0 |

Home cold runs were **1,800 / 1,356 / 1,552 ms**. Its **1,552 ms median is slower than the initial final 1,328 ms**, while remaining below the original 3,224 ms; neither run is hidden or substituted for the other. Current Home cold transfer is **473,172 B**, cold long-task time **788 ms**, and Discussion Event Timing **96/96 ms**. Division cold/repeat transfer is **303,154/7,179 B**, long-task time **252/138 ms**, and Tuesday timing **40/40 ms**.

The original Home **3,224→1,328 ms**, repeat CLS **0.2574→0**, transfer **−30.5%**, tasks **9,227→1,096 ms**, font transfer **−59.9%**, and Tuesday **112→48 ms** artifacts remain valid for the initial final revision. Current numbers describe the current revision and are lab medians, not field P75.

## 12. Division LCP cause and fix

The late LCP element was **`p.tt-help`** (size 42,602), not an image or data response. Affected pre-fix traces painted a 2,010-size loading span around 992–1,036 ms, then the real help paragraph around 1,368–1,528 ms. Other identical runs painted the paragraph directly. Division has zero Supabase/API reads and roughly 20 ms complete HTML in the server trace.

The root `app/loading.js` emitted a spinner plus a hidden complete timetable segment and React `$RC` reveal. Hydration scheduling therefore determined whether the fallback painted before reveal. CSS/DM Mono loading accounts for first-paint cost, but not this extra content replacement; offline/install mutations around 2.1 seconds and the clock around 3 seconds were later still.

The loading boundary now lives at **`app/(app)/loading.js`**, so authenticated routes retain it without wrapping the public division stream. Current initial HTML contains visible timetable/help content, with no fallback/hidden segment/reveal call. Current division LCP is **1,072 ms cold** (1,064–1,116) and **304 ms repeat** (296–340), with `p.tt-help` the element in every current raw run. Offline behavior remains **98/98**. Raw diagnosis: `production-mobile-followup-before-division-trace.json`, `...before-division-layout-trace.json`, and `...before/after-division-loading-boundary.json`.

## 13. Discussion interaction and phone geometry

The composer tab handler only calls **`setKind('discussion')`**. That mounts the existing title field and updates labels/selection; it does not fetch or rebuild the feed. Pre-fix controlled durations were **624/456/424 ms**, with only about 5–23 ms click processing. Frame/paint diagnostics isolated backdrop re-rasterization after the state update. Removing DepthField alone was insufficient; disabling visible backdrop sampling reduced the same diagnostic to **160/80/80 ms**. Event-detail requests occurred in slow and fast variants and were not the cause.

Scoped mobile rules now disable backdrop sampling for `.glass-floating`, `.glass-premium`, and `.home-pulse__stats`, using opaque computed backgrounds while retaining radii, gradients, rims, shadows, content, and desktop materials. Current matched Event Timing is **96 ms cold** (80–136) and **96 ms repeat** (56–96), below 200 ms in all six probes. This is synthetic Event Timing, not field INP. `tests/mobile-interaction-surfaces.test.js` guards the fix.

Phone aurora `top` and `height` use stable rem geometry so late real stats cannot move the decorative light. Current required-phone Slow-4G results:

| Width | Home LCP / CLS | Division LCP / CLS |
| --- | ---: | ---: |
| 360×800 | 1,300 ms / 0 | 1,064 ms / 0 |
| 375×812 | 1,276 ms / 0 | 1,072 ms / 0 |
| 390×844 | 1,328 ms / 0 | 1,116 ms / 0 |
| 412×915 | 1,272 ms / **0.0048** | 1,064 ms / 0 |

All **48 attempts** had zero horizontal overflow. The 412-wide residual is retained, not rounded away. Raw: `production-mobile-followup-final-required-phones.{json,txt}`.

## 14. Poll voting

`PollBlock` now applies a complete optimistic snapshot for selected styling, counts, percentages, and total. A ref prevents same-frame duplicate submissions; each card owns its own state. The server action retains the caller's RLS session, validates option/post membership, inserts one authorized vote, and reads trigger-maintained counts for reconciliation. Rejection restores the authoritative snapshot with `role="alert"`; a failed count read after a committed insert is not misreported as a rollback.

Full poll overlays prevent stale feed responses and Realtime/refetch double-counts. Home memory is patched per user for navigation return, while the mounted card owns its visible update. Voting causes no page reload, `router.refresh()`, whole-feed read, or new subscription.

Ten scenarios in `tests/poll-vote-state.test.js` cover immediate UI, unknown options, one-vote behavior, reconciliation, rollback, independent cards, cache synchronization, stale hydration, idempotent overlays, and closed polls. Production-browser/real-PostgreSQL acceptance passed all five workflows: immediate UI, rapid-click protection/independence, authoritative database counts, navigation away/back without a feed read/reload, and accessible rollback.

| Measurement | Before | Initial fixed run | Current fixed run |
| --- | ---: | ---: | ---: |
| Click Event Timing | 168 ms | 176 ms | **144 ms** |
| Visible selected-state mutation | None after 2,500 ms; still 0 votes | 83.1 ms | **69.2 ms** |

Current evidence: `production-mobile-followup-final-poll.{json,txt}`. Only the two initial feed GETs occurred; temporary rows were cleaned.

## 15. Feed, Blocked, and contrast follow-up

### Feed

The unchanged product and unchanged 20-second fallback now pass **15/15**. The idle check recorded **one POST at +0.0 seconds** when the page was brought to front, within the unchanged `≤1` assertion; no continuing idle polling occurred. Viewer convergence took **32.1 seconds** on the expected no-WebSocket path. This supports a visibility/reconciliation timing explanation rather than a feed correctness defect. The older two-read failure cannot be reconstructed retroactively and remains retained. Latest: `production-mobile-followup-feed-diagnostic-rerun.txt`.

### Settings → Blocked

Two separate defects were fixed:

1. The disposable SQL stub treated the output alias in `alias:resource!fk` as the resource table, causing a harness-only `PGRST100`. `scripts/dev/perf/sql.mjs` now separates alias, resource, and FK hint; three focused tests cover aliased/unaliased embeds.
2. The app also consumed PostgREST's nested `blocked` profile as a flat profile. `lib/blocks.js` now flattens it while retaining `created_at` and the related profile id, preventing the block-row id from reaching `ProfileActions`. A focused mapping test guards this.

No production FK, relationship, policy, or RLS changed. Rebuilt browser smoke loaded `/settings?tab=blocked` with HTTP 200, rendered **Meera Joshi / @meera_j**, unblocked the exact owned row, and confirmed after reload that Meera was removed while unrelated **@sara_f** remained. Raw: `production-mobile-followup-settings-blocked-smoke.json`.

**Hosted smoke remains required:** after an authorized deployment, repeat block/unblock with two ordinary institutional accounts, multiple blocked profiles, and ownership/anonymous denial checks. Local stub success is not hosted relationship-cache proof.

### Contrast

The settled intro-handover audit awaits the existing finite stats animation through `getAnimations()` rather than sampling transient opacity as settled content. Product colors, animation, and the 4.5:1 threshold were not changed; motion-phase checks remain. Current full result: **101 pages, 285 paints, 22,319 foregrounds (15,394 text; 6,925 icons), 29 focus states, 2 layout checks, 0 failures**. Raw: `production-mobile-followup-contrast-current.txt` and `...contrast-current-report.json`.

## 16. Current verification and security comparison

| Check | Current result | Evidence |
| --- | --- | --- |
| Build / lint / service worker | Passed; 87 static-generation steps; 15.2 kB worker current | `production-mobile-followup-final-blocked-build.txt`, `...final-lint.txt`, `...final-sw.txt` |
| Units | **81 files / 960 tests passed** | `production-mobile-followup-final-unit.txt` |
| Migrations / SQL suites | **37 migrations / 18 suites passed** | `production-mobile-followup-database-tests.txt` |
| Feed / pagination | **15/15; 11/11** | `production-mobile-followup-feed-diagnostic-rerun.txt`, `...pagination.txt` |
| Poll browser acceptance | **5/5 workflows; 69.2 ms visible mutation** | `production-mobile-followup-final-poll.json` |
| Offline / mobile fit | **98/98; 366/366** | `production-mobile-followup-offline.txt`, `...viewport.txt` |
| Contrast | **101 pages / 285 paints / 0 failures** | `production-mobile-followup-contrast-current-report.json` |
| Blocked browser smoke | Passed locally with correct target/unrelated-row preservation | `production-mobile-followup-settings-blocked-smoke.json` |
| Database audit | **67 passed / 0 warnings / 3 failed**, identical base/current | `production-mobile-followup-baseline-db-audit.txt`, `...current-db-audit.txt` |
| Security verification | Anonymous denials and browser secret scan pass; one pre-existing placeholder hygiene failure | `production-mobile-followup-final-security.txt` |
| Dependency audit | **19 vulnerabilities: 16 moderate, 2 high, 1 critical** | `production-mobile-followup-npm-audit.json` |

The three base/current database findings are unchanged: PUBLIC execute on five club/community helpers; `club_creation_requests` absent from the backup snapshot catalogue (65/66); and its missing capture trigger. No audit, grant, trigger, migration, or safeguard was changed to suppress them.

The placeholder grep reports only the same pre-existing harness/documentation matches. No real credential or new non-evidence placeholder was added. The dependency manifest/lockfile is unchanged, so the 19 vulnerable dependency versions were not introduced by this optimization. Critical/high entries include Next.js and Zod advisories; no unreviewed `npm audit fix` was run.

## 17. Review readiness

**Ready for code review, not release-approved or field-validated.** Local implementation and requested verification are complete, but the three database findings, placeholder hygiene failure, and 19 dependency vulnerabilities remain release-review items. Home's current **1,552 ms** cold median remains slower than the prior 1,328 ms run; Home 412-wide CLS is **0.0048** and Explore **0.0096**.

Fixture WebSocket 404s are expected. Hosted Realtime/OAuth/Supabase smoke, physical-device behavior, and real-user INP remain unmeasured. Hosted smoke must include Blocked and poll navigation return plus publishing, moderation/deletion, pagination, offline updates, and reconnect.

No merge, deployment, production migration, or production RES claim has been made. The only field result remains **RES 57/100 from 267 events**. Use §9 after an authorized deployment and record actual event counts and available P75 metrics, never estimates.
