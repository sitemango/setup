'use client';

import { useState } from 'react';
import { ClubMonogram } from '@/components/clubs/ClubMonogram';

/**
 * A club's mark, served through Campus+ (never straight from Drive).
 *
 * Renders the configured logo when one exists; on any failure — no logo
 * configured, gateway unavailable, bad bytes — degrades to the exact
 * ClubMonogram the cards and heroes used before, so a logo outage can never
 * blank the directory. The logo is a circle: every supplied mark is a
 * circle-in-square on black, which blends into the dark directory.
 */
export function ClubLogo({ src, name, id, size = 56, className = '' }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <ClubMonogram name={name} id={id} size={size} className={className} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- same-origin streaming endpoint; the optimizer adds nothing for a handful of ~60 KB JPEGs
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`club-logo ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  );
}
