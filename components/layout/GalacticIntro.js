'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import styles from './GalacticIntro.module.css';

// Memory belongs to this document only. No cookies/storage and no route keys.
// A completed intro cannot replay even if the boundary is later remounted.
let completed = false;

/* --------------------------------------------------------------------------
   Where the intro may appear
   --------------------------------------------------------------------------
   The home page is `/home`. `/` is a redirect-only route (`app/page.js` never
   paints content), so a document that was opened at `/` is still a landing at
   the home page — signed-in visitors are sent straight to `/home` and the
   intro must continue there rather than being torn down by the redirect.

   These sets are the whole routing contract: no other route can ever mount
   the intro, which is why the overlay can no longer cover `/login`, `/setup`,
   `/profile`, `/market`, `/communities`, `/chat`, `/settings`, `/campus` or
   any other page. */
const HOME_ROUTE = '/home';
const ROOT_ROUTE = '/';
/** Entry points that count as "arrived at the home page". */
const HOME_ENTRY_ROUTES = new Set([ROOT_ROUTE, HOME_ROUTE]);

/**
 * The route this document was opened at, captured once when the client bundle
 * is evaluated — before any Next client navigation can rewrite the URL. It is
 * `null` while rendering on the server, where the request pathname is already
 * the same value, so SSR and hydration always agree.
 */
const documentEntryPath =
  typeof window === 'undefined' ? null : window.location.pathname;

/**
 * Pure decision used by <LandingIntro> and by the unit tests:
 * show the intro only on the home page, only for a document that entered at
 * the home page (or the redirect-only root), and only once per document.
 */
export function shouldShowLandingIntro({ pathname, entryPath, done = false }) {
  if (done) return false;
  if (pathname !== HOME_ROUTE) return false;
  return HOME_ENTRY_ROUTES.has(entryPath);
}

/**
 * Route gate for the landing animation.
 *
 * This is the only place the intro is mounted. It sits in the root layout so
 * it survives the `/` → `/home` redirect, but the decision below is derived
 * purely from the route and the document entry, so nothing else can reach it:
 *
 *   `/` → `/home`          → plays (the document entered at the site root)
 *   `/home` (direct/refresh) → plays
 *   anything else           → nothing, ever
 *   client navigation to `/home` from another page → plays nothing
 *   client navigation away from `/home`             → overlay removed
 *   back to `/home` after the intro finished        → nothing (memory)
 *
 * No state and no effect is needed here, which keeps the server render and the
 * hydration render identical (no mismatch) and means children never remount
 * when the answer changes.
 */
export function LandingIntro({ children }) {
  const pathname = usePathname();
  // The server has no `window`; the request pathname is the entry path there.
  const entryPath = documentEntryPath ?? pathname;
  const show = shouldShowLandingIntro({
    pathname,
    entryPath,
    done: completed,
  });

  return <GalacticIntro enabled={show}>{children}</GalacticIntro>;
}

/* The intro is the only consumer of these two self-hosted variable faces.
   These names must stay in sync with GalacticIntro.module.css: the Font
   Loading API resolves @font-face family descriptors, not the names inside
   the font files (SpaceGrotesk.ttf actually calls itself "Space Grotesk
   Light", while its CSS family here is "Campus Galactic Space"). */
const SYNE_FAMILY = 'Campus Galactic Syne';
const SPACE_FAMILY = 'Campus Galactic Space';

const CAMPUS_TEXT = 'CAMPUS';
const PLUS_TEXT = '+';
const TAGLINE_TEXT = 'THE PCCOE FORUM';
const SKIP_LABEL = 'Skip intro';

/* Font shorthand used to select the @font-face. Its size only participates in
   face matching; 800/400 are the weights the intro actually renders. The
   glyph strings contain every character the intro paints in that family. */
const SYNE_FONT = `800 84px "${SYNE_FAMILY}"`;
const SPACE_FONT = `400 13px "${SPACE_FAMILY}"`;
const SYNE_GLYPHS = `${CAMPUS_TEXT}${PLUS_TEXT}`;
const SPACE_GLYPHS = `${TAGLINE_TEXT}${SKIP_LABEL}`;

/* Playback timing, all measured from the single transition to `playing`.
   The CSS keyframe delays in GalacticIntro.module.css mirror these values. */
const FADE_AT_MS = 5250;
const FINISH_AT_MS = 5650;
/* Phones get the same identity, not a six-second gate in front of the feed.
   The compact CSS choreography below lands with these times. */
const MOBILE_FONT_WAIT_MS = 1000;
const MOBILE_FADE_AT_MS = 1300;
const MOBILE_FINISH_AT_MS = 1700;

/* Bounded font wait. The old fixed 400 ms timer started the animation while a
   slow font request was still in flight, so a late load could swap the
   wordmark after it had already been measured. Three seconds gives cold
   deployments and Edge's first-request font handling room to finish, while
   still guaranteeing the overlay never waits forever. */
const FONT_WAIT_MS = 3000;
/* Independent deadline, measured from effect mount. It covers the longest
   possible startup (the full font budget) plus the normal sequence plus the
   previous 550 ms of slack. It does not depend on animation events, fonts or
   SVG APIs. */
const SAFETY_DEADLINE_MS = FONT_WAIT_MS + 6200;
/* The CSS stage has a second, script-independent emergency deadline. Derive
   its delay from the same value so the JS and CSS deadlines cannot drift. */
const SAFETY_CSS_DELAY_MS = SAFETY_DEADLINE_MS + 300;
const SAFETY_STYLE = { '--intro-safety-delay': `${SAFETY_CSS_DELAY_MS}ms` };

const normalizeFamily = (value) =>
  String(value).replace(/["']/g, '').trim().toLowerCase();

/**
 * Explicitly load the exact families, weights and characters used by the
 * intro, then verify that the custom faces are really available.
 *
 * `FontFaceSet.check()` alone is not sufficient: it returns `true` for a
 * family with no matching @font-face rule because the browser can always use
 * a fallback. Only a non-empty `load()` result whose faces are `loaded`
 * proves the custom face was parsed and fetched. `fonts.ready` additionally
 * waits for the browser to finish layout with those faces before the SVG is
 * measured.
 */
async function introFontsReady() {
  const fonts = document.fonts;
  if (
    !fonts ||
    typeof fonts.load !== 'function' ||
    typeof fonts.check !== 'function'
  ) {
    return false;
  }
  const [syneFaces, spaceFaces] = await Promise.all([
    fonts.load(SYNE_FONT, SYNE_GLYPHS),
    fonts.load(SPACE_FONT, SPACE_GLYPHS),
  ]);
  const hasLoadedFace = (faces, family) =>
    faces.some(
      (face) =>
        face.status === 'loaded' &&
        normalizeFamily(face.family) === normalizeFamily(family),
    );
  if (
    !hasLoadedFace(syneFaces, SYNE_FAMILY) ||
    !hasLoadedFace(spaceFaces, SPACE_FAMILY)
  ) {
    return false;
  }
  await fonts.ready;
  return (
    fonts.check(SYNE_FONT, SYNE_GLYPHS) &&
    fonts.check(SPACE_FONT, SPACE_GLYPHS)
  );
}

/**
 * Text advance in SVG user units. `getComputedTextLength()` includes CSS
 * letter-spacing and is the same metric the original layout used. `getBBox()`
 * is only a defensive fallback for engines that refuse text metrics while the
 * element is hidden by `visibility`.
 */
function textAdvance(element) {
  try {
    const length = element.getComputedTextLength();
    if (Number.isFinite(length) && length > 0) return length;
  } catch {
    // Fall through to the bounding box.
  }
  try {
    const width = element.getBBox().width;
    if (Number.isFinite(width) && width > 0) return width;
  } catch {
    // Leave the server-rendered pair in place rather than holding the page.
  }
  return 0;
}

export default function GalacticIntro({ children, enabled = true }) {
  // Identical server/client first render; consult document memory in the effect.
  const [phase, setPhase] = useState('waiting');
  const focusOnReveal = useRef(false);
  const content = useRef(null);
  const stage = useRef(null);
  const campus = useRef(null);
  const plus = useRef(null);
  const skip = useRef(null);

  function finish() {
    focusOnReveal.current = document.activeElement === skip.current;
    completed = true;
    setPhase('done');
  }

  useEffect(() => {
    // Route gate closed: no fonts, timers, listeners or overlay work at all.
    if (!enabled) return undefined;
    if (completed) {
      const timer = setTimeout(() => setPhase('done'), 0);
      return () => clearTimeout(timer);
    }
    let disposed = false;
    let started = false;
    let finished = false;
    let settled = false;
    let fontTimer;
    let frame = 0;
    const timers = [];
    const later = (fn, delay) => {
      const id = setTimeout(fn, delay);
      timers.push(id);
      return id;
    };
    // Resolve after the browser has applied style and layout at least once.
    // The timer bounds the wait for engines or tabs that throttle animation
    // frames, so startup can never stall on rAF alone. Keeping the latest
    // frame id here lets cleanup cancel a pending startup.
    const nextPaint = () =>
      new Promise((resolve) => {
        let done = false;
        const settlePaint = () => {
          if (done) return;
          done = true;
          resolve();
        };
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(settlePaint);
        });
        later(settlePaint, 250);
      });
    const end = () => {
      if (disposed || finished) return;
      finished = true;
      focusOnReveal.current = document.activeElement === skip.current;
      completed = true;
      setPhase('done');
    };
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const compact = window.matchMedia('(max-width: 767px)').matches;
    const fontWaitMs = compact ? MOBILE_FONT_WAIT_MS : FONT_WAIT_MS;
    const fadeAtMs = compact ? MOBILE_FADE_AT_MS : FADE_AT_MS;
    const finishAtMs = compact ? MOBILE_FINISH_AT_MS : FINISH_AT_MS;
    const onMotion = () => {
      if (motion.matches) end();
    };
    motion.addEventListener('change', onMotion);
    const onKey = (event) => {
      if (event.key === 'Escape') end();
    };
    window.addEventListener('keydown', onKey);
    // Independent of animation events, fonts and SVG APIs. Sized to include
    // the longest font wait plus the full choreography.
    later(end, SAFETY_DEADLINE_MS);

    // Freeze the typography for the whole intro. In the fallback case this
    // removes every reference to the custom families before measurement, so a
    // font that arrives after the timeout cannot change the logo, tagline or
    // Skip intro control mid-animation.
    function lockTypography(fallback) {
      if (stage.current) {
        stage.current.dataset.typography = fallback ? 'fallback' : 'loaded';
      }
    }

    function positionLockup() {
      if (!campus.current || !plus.current) return;
      // One measurement pass, two derived positions. Both attributes are
      // applied together before `playing` is committed.
      const campusLength = textAdvance(campus.current);
      const plusLength = textAdvance(plus.current);
      if (!(campusLength > 0 && plusLength > 0)) return;
      const x = (760 - campusLength - 24 - plusLength) / 2;
      campus.current.setAttribute('x', String(x));
      plus.current.setAttribute('x', String(x + campusLength + 24));
    }

    async function beginPlayback(fallback) {
      if (disposed || started || finished || completed) return;
      // Typography is final *before* any measurement or paint.
      lockTypography(fallback);
      // Let the browser apply the selected typography and settle the SVG
      // layout. Measuring in the same task as the style change is what made
      // the old code depend on engine-specific font application timing.
      await nextPaint();
      if (disposed || started || finished || completed) return;
      positionLockup();
      started = true;
      setPhase('playing');
      later(() => {
        if (!disposed && !finished && !completed) setPhase('fading');
      }, fadeAtMs);
      later(end, finishAtMs);
    }

    // The font-loaded callback, the bounded timeout and any early exit all
    // converge here. `settled` makes the startup single-shot; `started` makes
    // the playback single-shot as well.
    function settle(fallback) {
      if (disposed || settled || started || finished || completed) return;
      settled = true;
      clearTimeout(fontTimer);
      beginPlayback(fallback);
    }

    if (motion.matches) {
      // Reduced motion never needs the choreography or the font wait.
      later(end, 100);
    } else {
      fontTimer = later(() => settle(true), fontWaitMs);
      // A rejection (network/parse error) is a definitive failure and falls
      // back immediately; a hanging request is caught by the timer above.
      introFontsReady().then(
        (ready) => settle(!ready),
        () => settle(true),
      );
    }
    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', onMotion);
      window.removeEventListener('keydown', onKey);
    };
    // `enabled` is the route gate. Leaving the home page re-runs this effect's
    // cleanup (timers, frames, listeners) and stops the animation immediately;
    // arriving at the home page after the `/` redirect starts it once.
  }, [enabled]);

  useEffect(() => {
    if (phase === 'done' && focusOnReveal.current) {
      content.current?.focus({ preventScroll: true });
      focusOnReveal.current = false;
    }
  }, [phase]);

  const visible = enabled && phase !== 'done';
  return (
    <>
      {visible && (
        <section
          ref={stage}
          className={styles.stage}
          data-phase={phase}
          style={SAFETY_STYLE}
          aria-label="Campus+ intro"
        >
          <div aria-hidden="true" className={styles.scenery}>
            <div className={styles.nebula}>
              <div />
              <div />
            </div>
            <div className={styles.stars} />
            <div className={styles.haze} />
            <div className={styles.vignette} />
            <div className={styles.flare} />
            <div className={styles.center}>
              <div className={styles.lockup}>
                <svg
                  className={styles.logo}
                  viewBox="0 0 760 110"
                  preserveAspectRatio="xMidYMid meet"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <text ref={campus} x="112" y="62" className={styles.campus}>
                    {CAMPUS_TEXT}
                  </text>
                  <text ref={plus} x="600" y="62" className={styles.plus}>
                    {PLUS_TEXT}
                  </text>
                </svg>
              </div>
              <div className={styles.tagline}>{TAGLINE_TEXT}</div>
            </div>
          </div>
          <button
            ref={skip}
            type="button"
            className={styles.skip}
            onClick={finish}
          >
            {SKIP_LABEL}
          </button>
        </section>
      )}
      <div ref={content} tabIndex={-1} inert={visible ? true : undefined}>
        {children}
      </div>
    </>
  );
}
