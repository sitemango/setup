import { preload } from 'react-dom';

/**
 * Home — the one route that shows the landing animation, and the one route
 * that owns `app/styles/home.css`.
 *
 * The intro itself is mounted by the root layout's `<LandingIntro>` gate (it
 * has to sit above the app shell to cover it, and above `/` so the `/` → `/home`
 * redirect does not tear it down). This layout adds the two self-hosted faces
 * that only the intro paints, so the critical font hints ship with the only
 * route that can use them: `/login`, `/setup` and every app page no longer
 * preload fonts they never render.
 *
 * Each file is a single variable face covering every weight the intro uses, so
 * these hints do not preload unused weights. `crossOrigin: 'anonymous'` matches
 * the CORS mode browsers use for fonts; without it the preload would be
 * fetched twice.
 *
 * The stylesheet import is global CSS, not a CSS Module: the class names are
 * the contract the Home components already use. `home.css` is the largest
 * single style file in the product and every selector in it belongs to Home
 * (the pulse band, the two doors, the stream skins, the contextual rail), so
 * importing it here — instead of from `globals.css` — keeps it out of the
 * shared stylesheet every other page has to download.
 */
import '@/app/styles/home.css';
// Home owns the first-visit offer too; neither its stylesheet nor its tiny
// pre-paint storage check belongs in the shared shell or on public routes.
import '@/app/styles/guide-strip.css';

export default function HomeLayout({ children }) {
  preload('/fonts/Syne.ttf', {
    as: 'font',
    type: 'font/ttf',
    crossOrigin: 'anonymous',
  });
  preload('/fonts/SpaceGrotesk.ttf', {
    as: 'font',
    type: 'font/ttf',
    crossOrigin: 'anonymous',
  });

  return children;
}
