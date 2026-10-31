'use client';

/**
 * The Home depth field, as a React layer.
 *
 * One canvas for the whole homepage, mounted once, behind everything the
 * student reads. It is decorative in the strictest sense: `aria-hidden`,
 * `pointer-events: none` and never focusable, so it can neither announce itself
 * to a screen reader nor take a click, a keypress or a scroll.
 *
 * Failure handling is the same shape as the login ghost's, because the same
 * things can go wrong:
 *   - the scene module is loaded on demand, so `three` is not in the first
 *     chunk of a page that may never need it;
 *   - phone-sized, coarse-pointer, reduced-motion and data-saving visits keep
 *     the finished CSS composition instead of downloading and compiling a
 *     decorative GPU scene while the student is trying to read or tap;
 *   - capability is checked **before** the import. No WebGL, a failed import,
 *     a thrown scene, or a lost context all select the same CSS composition —
 *     never an empty band where the atmosphere should be;
 *   - the CSS composition is also the loading surface, so capable desktops do
 *     not flash an empty background before their scene arrives.
 *
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { webglAvailable } from '@/components/atmosphere/webgl';

/**
 * The static composition: three soft ridges and a horizon glow, all CSS. It is
 * what a no-WebGL browser sees, and it keeps the same palette, the same depth
 * language and the same restraint — just without movement.
 */
function DepthFieldFallback() {
  return (
    <div className="depth-field__fallback" aria-hidden="true">
      <span className="depth-field__ridge depth-field__ridge--far" />
      <span className="depth-field__ridge depth-field__ridge--mid" />
      <span className="depth-field__ridge depth-field__ridge--near" />
      <span className="depth-field__horizon" />
    </div>
  );
}

/** Pure device policy, kept separate from browser globals for direct tests. */
export function shouldUseStaticDepthField({ reducedMotion = false, coarse = false, narrow = false, saveData = false } = {}) {
  return Boolean(reducedMotion || coarse || narrow || saveData);
}

export function DepthField({ className = '' }) {
  const containerRef = useRef(null);
  const [mode, setMode] = useState('fallback');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let cancelled = false;
    let dispose = null;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const staticField = shouldUseStaticDepthField({
      reducedMotion,
      coarse: window.matchMedia?.('(pointer: coarse)').matches ?? false,
      narrow: Math.min(window.innerWidth, window.innerHeight) < 720,
      saveData: navigator.connection?.saveData,
    });

    // A decorative scene must not download a renderer on a path that will only
    // replace it with CSS. On a capable desktop the dynamic chunk remains.
    if (staticField || !webglAvailable()) return undefined;

    import('./depth/createDepthField')
      .then(({ createDepthField }) => {
        if (cancelled) return;
        try {
          dispose = createDepthField(container, {
            reducedMotion,
            onContextLost: (reason) => {
              // The GPU took the canvas away, or the shader never compiled:
              // show the CSS composition instead of leaving a dead layer behind
              // the interface.
              if (reason) console.warn(`[Campus+] Depth field unavailable: ${reason}`);
              container.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
              setMode('fallback');
            },
          });
          setMode('webgl');
        } catch (error) {
          container.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
          console.warn('[Campus+] Depth field unavailable; showing the static atmosphere.', error);
          setMode('fallback');
        }
      })
      .catch((error) => {
        console.warn('[Campus+] Depth field failed to load; showing the static atmosphere.', error);
        if (!cancelled) setMode('fallback');
      });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return (
    <div ref={containerRef} className={cn('depth-field', className)} data-state={mode} aria-hidden="true">
      {mode !== 'webgl' ? <DepthFieldFallback /> : null}
      {/* Separates the environment from the interface: a wash at the top so the
          sticky glass header keeps a compatible backdrop, and a vignette at the
          bottom so the field never competes with the feed. */}
      <span className="depth-field__scrim" />
    </div>
  );
}
