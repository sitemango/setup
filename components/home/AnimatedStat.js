'use client';

import { useEffect, useRef } from 'react';

// The accessible and server-rendered value is always the real count. Only the
// aria-hidden visual copy animates, so assistive technology never hears ticks.
export function AnimatedStat({ value }) {
  const visual = useRef(null);

  useEffect(() => {
    const node = visual.current;
    if (!node) return undefined;
    const media = window.matchMedia('(min-width: 768px) and (prefers-reduced-motion: no-preference)');
    let frame;
    const reset = () => {
      cancelAnimationFrame(frame);
      node.textContent = String(value);
    };
    const animate = () => {
      reset();
      if (!media.matches || !Number.isSafeInteger(value) || value <= 0) return;
      let start;
      const tick = (now) => {
        start ??= now;
        const progress = Math.min((now - start) / 650, 1);
        node.textContent = String(Math.round(value * (1 - (1 - progress) ** 3)));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    animate();
    media.addEventListener('change', animate);
    return () => { media.removeEventListener('change', animate); reset(); };
  }, [value]);

  return <><span className="sr-only">{value}</span><span ref={visual} aria-hidden="true">{value}</span></>;
}
