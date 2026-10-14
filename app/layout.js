import './globals.css';

import localFont from 'next/font/local';
import { PLATFORM } from '@/lib/constants';
import { readTheme } from '@/lib/theme';
import { SlideOverTransition } from '@/components/layout/SlideOverTransition';

/* The Campus+ After Dark typefaces, self-hosted from the reference
   repository's assets (aminotkartik/loginpage). They are loaded once, here,
   and exposed as CSS variables on <body> so every screen can reach for them:

     --font-display → Boldonse, used only for cinematic entry headings
     --font-micro   → DM Mono, used only for short technical micro-labels

   Body copy stays on the Inter/UI stack: a display face at reading size would
   hurt the everyday feed, and a monospace face at paragraph size would hurt
   legibility more than it would add atmosphere. Both faces are `swap`, so a
   slow font never blocks first paint. */
const displayFont = localFont({
  src: './fonts/Boldonse-Regular.ttf',
  variable: '--font-display',
  display: 'swap',
});

const microFont = localFont({
  src: [
    { path: './fonts/DMMono-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/DMMono-Medium.ttf', weight: '500', style: 'normal' },
  ],
  variable: '--font-micro',
  display: 'swap',
});

/**
 * Campus+ — root layout.
 *
 * One reading family (Inter → platform UI) plus two deliberately rationed
 * atmospheric faces: a display face for cinematic entry points and a monospace
 * face for micro-labels. No icon webfont. The application frame (sidebar /
 * bottom navigation) is applied per-route group so the sign-in and setup
 * screens can stay deliberately plain.
 *
 * The appearance (light/dark) is stored in a cookie and read here, so the very
 * first paint already has the right palette: no flash of the wrong theme, and
 * no inline bootstrap script. `applyTheme()` keeps the cookie in step.
 *
 * The reading stack prefers Inter (then Geist) and falls back to the platform
 * UI font. Inter is not fetched at build time on purpose: a build that depends
 * on a third-party CDN cannot be reproduced offline. To self-host it, drop the
 * woff2 files into app/fonts/ and switch to next/font/local — see
 * docs/DEPLOYMENT.md.
 */

export const metadata = {
  title: {
    default: `${PLATFORM.name} — ${PLATFORM.collegeName}`,
    template: `%s · ${PLATFORM.name}`,
  },
  description: `${PLATFORM.tagline} An unofficial, text-first platform for ${PLATFORM.collegeName} students.`,
  applicationName: PLATFORM.name,
  // No images, no social preview cards: Campus+ is text-first and stores no media.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f5f1' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1120' },
  ],
};

export default async function RootLayout({ children }) {
  const theme = await readTheme();

  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <body className={`${displayFont.variable} ${microFont.variable} min-h-dvh bg-canvas text-ink antialiased`}>
        {children}
        <SlideOverTransition />
      </body>
    </html>
  );
}
