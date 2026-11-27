'use client';

/**
 * The blue ghost as a React layer over the Campus+ particle sky.
 *
 * On capable browsers `createGhostScene` (Three.js, loaded on demand) draws the
 * live ghost into a container this component owns. A fresh canvas is created
 * on every mount, because React Strict Mode mounts effects twice and a lost
 * WebGL context cannot be reused. Without WebGL, or if the scene fails, the
 * reference's static SVG ghost is shown instead, so the screen is never empty.
 *
 * Colours come from the design tokens in app/styles/login.css. The container
 * is decorative: it is aria-hidden and ignores pointer events.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const GHOST_PATH =
  'm508.374 432.802s-46.6-39.038-79.495-275.781c-8.833-87.68-82.856-156.139-172.879-156.139-90.015 0-164.046 68.458-172.879 156.138-32.895 236.743-79.495 275.782-79.495 275.782-15.107 25.181 20.733 28.178 38.699 27.94 35.254-.478 35.254 40.294 70.516 40.294 35.254 0 35.254-35.261 70.508-35.261s37.396 45.343 72.65 45.343 37.389-45.343 72.651-45.343c35.254 0 35.254 35.261 70.508 35.261s35.27-40.772 70.524-40.294c17.959.238 53.798-2.76 38.692-27.94z';

/** The reference's no-WebGL ghost (its `.fallback-ghost`), drawn in SVG. */
function GhostFallback() {
  return (
    <div className="login-ghost-fallback" aria-hidden="true">
      <svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="campus-ghost-fallback-blue" cx="35%" cy="25%" r="75%">
            <stop className="login-ghost-stop-a" offset="0%" />
            <stop className="login-ghost-stop-b" offset="42%" />
            <stop className="login-ghost-stop-c" offset="100%" />
          </radialGradient>
          {/* A tighter blur than the reference's: the fallback must carry the
              same restrained glow as the WebGL scene, not a screen-wide halo. */}
          <filter id="campus-ghost-fallback-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="a" />
            <feMerge>
              <feMergeNode in="a" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          d={GHOST_PATH}
          className="login-ghost-body"
          fill="url(#campus-ghost-fallback-blue)"
          filter="url(#campus-ghost-fallback-glow)"
        />
        <circle className="login-ghost-socket" cx="208" cy="225" r="23" />
        <circle className="login-ghost-socket" cx="297" cy="225" r="23" />
        <circle className="login-ghost-eye" cx="208" cy="225" r="9" />
        <circle className="login-ghost-eye" cx="297" cy="225" r="9" />
      </svg>
    </div>
  );
}

export function GhostScene({ className = '', placement = 'login' }) {
  const containerRef = useRef(null);
  const [mode, setMode] = useState('loading');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let cancelled = false;
    let dispose = null;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    import('./ghost/createGhostScene')
      .then(({ createGhostScene, webglAvailable }) => {
        if (cancelled) return;
        if (!webglAvailable()) {
          setMode('fallback');
          return;
        }
        try {
          dispose = createGhostScene(container, { reducedMotion, placement });
          setMode('webgl');
        } catch (error) {
          // Remove any half-built canvas so only the static ghost remains.
          container.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
          console.error('[Campus+] Ghost scene unavailable; showing the static ghost.', error);
          setMode('fallback');
        }
      })
      .catch((error) => {
        console.error('[Campus+] Ghost scene failed to load; showing the static ghost.', error);
        if (!cancelled) setMode('fallback');
      });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [placement]);

  return (
    <div
      ref={containerRef}
      className={cn('login-ghost-layer', className)}
      data-state={mode}
      aria-hidden="true"
    >
      {mode === 'fallback' ? <GhostFallback /> : null}
    </div>
  );
}
