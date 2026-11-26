import localFont from 'next/font/local';
import '@/app/styles/login.css';
import '@/app/styles/lumen.css';
import '@/app/styles/aurora.css';
import '@/app/styles/liquid-glass.css';

/**
 * The sign-in poster face.
 *
 * The sign-in heading is set the way a film poster sets its title — condensed,
 * uppercase, stacked, filling the column — so this route owns the one display
 * face it needs. It is declared here, not in the root layout, so `next/font`
 * emits the preload only on `/login` and `/login/verify`: no other screen pays
 * for a font it never renders (see docs/performance/2026-10-23-audit.md, #3).
 *
 * Anton, SIL OFL 1.1 (`app/fonts/Anton-LICENSE.txt`), self-hosted for the same
 * reason as Geist and Instrument Serif: production and offline builds never
 * depend on a font CDN. It is one weight, so `font-synthesis: none` on the
 * heading keeps the browser from faking bold and smearing the tight counters.
 */
const posterFont = localFont({
  src: '../fonts/Anton-Regular.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-poster',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
});

/** Sign-in shares the root Lumen font loaders; this route adds the poster face. */
export default function LoginLayout({ children }) {
  return <div className={posterFont.variable}>{children}</div>;
}
