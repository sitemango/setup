# Login LCP investigation

Local investigation only; no deployment. Node 24.22.3, production Next build with dummy public Supabase configuration, Lighthouse 12.8.2, Chromium 133, mobile 412×915, DPR 1.75, simulated throttling, SwiftShader. The desktop configuration uses 1350×940, DPR 1. These results are not directly comparable with production or real-device measurements. Vercel telemetry and real authentication were not exercised.

## Results

LCP is consistently the first `span.login-title-line` in `h1.login-title`, “THE CAMPUS,” for every successful run below. It is text, not an image. Values are Lighthouse **simulated** milliseconds. Every row contains all runs, including failures. TTFB and render columns show individual results in the same order; resource delay and duration are zero throughout successful runs. Baseline and A–C go through the same diagnostic proxy, which injects CSS and recompresses assets; the remaining tests use the production server directly, so small differences across those groups are not conclusive.

| Test | LCP runs (ms) | TTFB runs (ms) | Render delay runs (ms) | Median LCP |
| --- | --- | --- | --- | --- |
| Proxy baseline | 4153, 4071, 4056, 3907 | 506, 472, 467, 472 | 3647, 3600, 3589, 3435 | 4064 |
| A: disable heading and ancestor animations/transitions | 4055, 4173, 3862, 3843 | 492, 477, 472, 462 | 3563, 3695, 3390, 3381 | 3958 |
| B: force visible and opacity 1 on heading and ancestors | 3875, 4072, 3800, 4224 | 468, 465, 470, 471 | 3406, 3607, 3330, 3753 | 3973 |
| C: Arial instead of Anton | NO_LCP, 4016, 4050, 4139 | —, 466, 473, 465 | —, 3550, 3577, 3675 | 4050 (3 valid) |
| D: GhostScene replaced with empty layer | 4052, 4001, 3960, 4016 | 480, 463, 458, 459 | 3572, 3538, 3502, 3557 | 4009 |
| E: background beams replaced with empty element | 3865, 3845, 4109, 3896 | 478, 464, 460, 470 | 3387, 3381, 3649, 3426 | 3880 |
| F: block all Next JS chunks | 2891, 3034, 3034, 2917 | 464, 459, 458, 472 | 2427, 2576, 2575, 2445 | 2975 |

A and B vary substantially and do not establish a reliable improvement. B forced opacity and visibility simultaneously, not independently, so it does not isolate their separate effects. Arial overflows the viewport and is not a viable design. D and E intentionally remove visual elements and are diagnostic only; E also uses a minimal placeholder rather than a precise beams DOM substitute. F prevents hydration, login and other client-side features, and changes all client initialization at once; it indicates a JS-related contribution to the simulated result, not which component or whether the contribution represents a fixable real-device delay. No experiment is proposed for production. D had a 0.120 CLS outlier in run 4; other mobile experiment runs had zero CLS.

Screenshots, after approximately 1.5 seconds, are in [lcp-visuals](lcp-visuals/): `base`, `a`, `b`, `c`, `no-ghost`, `no-beams`, and `nojs`. They are software-rendered captures and do not validate hardware Three.js. The system-font capture visibly clips the poster text. These are static snapshots and do not validate entrance-motion equivalence.

## Measurements and limits

The direct pre-experiment mobile Node 24 baseline was performance 84, FCP 1.685s, LCP 4.025s, TBT 164ms and CLS 0 (three-run medians). In a separate three-run direct trace sample the LCP values were 4060, 4175 and 4150ms; performance 77, 84 and 82, with a CLS 0.174 outlier in run 1. In sample 2, the *observed* trace records FCP at 381ms and the text LCP candidate at 1677ms, versus Lighthouse's *simulated* FCP 1668ms and LCP 4175ms. These different timelines must not be combined. Trace evidence does not establish a single root cause for the observed or simulated gap.

At a 1.5-second inspection point, the heading and all ancestors had opacity 1, visibility visible and no transform or active animation; the poster font was loaded. The heading itself was returned by `elementFromPoint` at its center; that hit test does not prove there is no pointer-transparent visual overlay. CSS defines a 900ms parent opacity/translate reveal with 80ms delay, but sampling only after it finishes does not establish its early paint behavior. In a separate browser capture with JavaScript disabled, the SSR heading remained visible; login functionality was not usable.

In the four-task trace sample, Lighthouse simulated these tasks: 158ms from `/_next/static/chunks/3lm3iru4lln-4.js` at 3877ms; 124ms unattributable at 759ms; 73ms from `/_next/static/chunks/092r-mewpaf3q.js` at 3804ms; and 55ms from `/` at 890ms, all before the simulated 4175ms LCP. The raw trace shows a 39.5ms main-thread task containing 38.4ms script evaluation of `3lm3iru4lln-4.js` and microtasks with a 0.7ms minified `fq` call in `092r-mewpaf3q.js`; another 18.3ms task evaluates `092r-mewpaf3q.js`. Other raw work includes navigation/document parsing, style, layout and paint. Raw durations are not Lighthouse simulated durations. The production chunks are minified; this trace does not provide reliable full function stacks or attribution of each simulated task to React, login, GhostScene, or analytics. It would be unsafe to split code based on this evidence alone. A separate unthrottled sampling profile found React/Next chunk initialization and a small OffscreenCanvas probe callback, but not function-level attribution of all four tasks.

## Desktop and hardware

Four fresh direct desktop runs: scores 99, 100, 99, 99; LCP 866, 809, 868, 894ms; TBT 7.5, 0, 18, 11.5ms; CLS 0, 0.036, 0.039, 0. Median score 99, LCP 867ms, TBT 9.5ms, CLS 0.018. All four were valid. Previous first-pass desktop after-runs included four `NO_LCP` failures out of seven; FCP was present on those failures. No old raw trace was captured, so their cause—instrumentation, lifecycle, WebGL, or actual rendering—remains unidentified. A failed initial diagnostic trace-saving command also stopped before saving a report. An initial proxy experiment expanded compressed assets and produced unrepresentative LCP timings, with one NO_LCP each for A, B and C; it was discarded and rerun with compression.

No `/dev/dri` GPU device is available in this environment. No real-device or hardware-accelerated validation of the Three.js appearance, bloom/output, resize, context loss/recovery, disposal, reduced motion, or background suspension was performed. The existing unit tests are not a substitute. The no-WebGL SVG fallback was visually captured using SwiftShader, but quality relative to real hardware remains unverified. Real OAuth was not tested.

## Verification and changes

Node 24 production build succeeded and `npm run verify` passed 182 files / 1,648 tests. `git diff --check` passed. Diagnostic source edits were restored; no LCP or visual change was retained. Existing first-pass changes remain in `app/styles/background-beams.css`, `components/atmosphere/GhostScene.js`, `components/atmosphere/ghost/createGhostScene.js`, `components/atmosphere/webgl.js`, `components/atmosphere/ghost/probe.js`, `tests/ghost-lifecycle.test.js`, and `tests/webgl-performance.test.js`. This investigation adds this report and its screenshot files only.
