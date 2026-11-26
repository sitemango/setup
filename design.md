# Design: Campus+

The Halo system. Every route reads this first and shares it. Change it on purpose; this file is the rule.

## System
- Genre: atmospheric, premium SaaS
- Shape: App Screen; public document flows remain document flows
- Theme: Halo, night + day — both individually designed, explicit toggle
- Axes: dark/cool-ice/warm-sand · posture: confident, luminous, restrained
- Redesign: full, presentational only; the Campus+ product, routes, data and behavior are preserved
- Identity: the ice-blue accent and warm sand counter-accent are the brand; the serif wordmark, lowercase page titles, mono chips and the waving-hand greeting remain

## Layers
Materials resolve in this order (later wins):
1. Route sheets (`home.css`, `sections.css`, `calendar.css`, …) — structure and composition
2. `app/styles/lumen.css` — the flattening pass, kept as the structural/type baseline
3. `app/styles/aurora.css` — the Halo material layer: surfaces, chrome, light, motion

`aurora.css` is imported last in `app/globals.css` **and** after `lumen.css` in every route layout that imports Lumen directly (home, gigs, clubs, public, guide, login, timetable). Unlayered `:root`-prefixed selectors beat the `@layer components` route sheets; source order breaks ties with Lumen. Never rely on an initial-value reset (`x: none/0`) to override a layered rule — the minifier drops it as redundant; change the source value instead.

## Tokens
`app/tokens.css` is the source of truth. `app/globals.css` maps its roles into the established Campus+ semantic names (`--cp-*`, `--color-*`). Per theme:
- Papers: three surface steps (`--color-paper/-2/-3`); dark reads slate-blue, day reads warm ivory
- Ink: three text tiers (`--color-ink/-2`, `--color-muted`) — every tier ≥ 4.5:1 on every surface, enforced by `tests/contrast.test.js`
- Accent: ice blue (`--color-accent`, `--color-accent-text` for text-on-paper); warm sand counter-accent (`--color-accent-warm`, `--color-accent-2`)
- Material roles: `--halo-page/-hero/-chrome` (ambient compositions), `--grad-surface/-hover/-chrome/-well/-accent/-hairline` (gradient fills), `--edge-light` (top rim), `--glow-accent/-warm/-soft`, `--shadow-glow/-lift`, `--depth-1/-2/-3` (layered ambient shadows)
- Glass: `--cp-bg-glass*` are ≥ 96% backed (strong is fully opaque) so text contrast holds over any underlay; blur is an enhancement, never a dependency
- Radii: card 14px, glass 20px, pill 999px; type scale, spacing, easings and durations (`--dur-panel: 320ms`, `--dur-gesture: 720ms`) live in tokens

## Surfaces
- Cards, islands, glass family: vertical gradient fill + 1px rule + inset top rim (`--edge-light`) + layered `--depth-*` shadow; hover lifts 2–3px into `--depth-2/3` with a brighter rim
- Feature tiles carry a per-tile `--tile-accent` wash, tinted icon container and an arrow that travels on hover
- Stream cards keep a 2px kind-marker spine (`--stream-marker`: notice warm, event accent, post muted) and a one-shot entry sweep on hover
- Wells (search fields, composer textarea, filter bars) are inset: darker gradient + inner shadow
- Primary buttons: `--grad-accent` fill, bright rim, accent glow; hover brightens, active presses to 0.97. The hero CTA keeps its liquid sheen, flowing only while hovered/focused, clipped to the pill

## Chrome
- Sidebar: floating glass rail (12px inset, 20px radius, blur 22px) with gradient chrome fill; active item gets an accent blade + soft wash; groups separated by a lit rule
- Header: floating glass bar; search pill blooms an accent ring on focus
- Mobile: floating dock with active blade; sheets and menus are backed glass over a blurred scrim
- Public frame: lit gradient hairlines under header / over footer

## Type
- Page and section headings: Instrument Serif 400, lowercase
- Sign-in heading: the poster title — Anton 400 (SIL OFL, self-hosted in `app/fonts/`, loaded by `app/login/layout.js` so only `/login` preloads it), uppercase, one phrase per line, stacked at `line-height: 0.86`. The size is fitted to the column, not to breakpoints: `font-size: calc(100cqw / var(--login-title-fit) / var(--login-title-scale))` inside the login column's `container-type: inline-size`; `--login-title-scale` is the one knob for how far the block sits inside the measure (currently `1.16`, i.e. a little in from the edges)
- Sign-in heading surface: the galactic glass. Three layers clipped to the glyphs (`background-clip: text`) share one surface across both lines — a specular glint and a light pool that repeat once per row of caps (`background-size: 100% 50%`, `background-repeat: repeat-y`), over a diagonal field of the galaxy's three stops: ice-blue `--login-title-cool`, the page's paper, warm sand `--login-title-warm`. The stops live on `.login-stage`, not on the heading, so `.login-rule` can draw the same run (custom properties do not reach a sibling). A solid paper `color` remains the fallback without clip support. The family is the single documented exception to the global `h1` → Geist rule in `app/globals.css`
- Hero greeting: serif "Hey," over the name in locally hosted Geist 700 with a subtle ice gradient (background-clip: text) and the inline waving hand
- Interface, labels, buttons, reading copy: Geist 400/500; figures and technical readouts: Geist Mono, tabular
- Eyebrows: mono uppercase chips; the home stats band is the single blueprint-grid figures well

## Motion
- Quick, fluid easing (`--ease-out`); entrances 320–520ms; hovers 180–260ms; press 0.97
- Ambient loops are slow and low-contrast: hero aurora breathe 18s, spark drift 13/17s, horizon travel 17s, pulse 5.5s; sheen runs only while engaged
- Theme switch cross-fades surfaces (320ms); overlays scale/fade from their trigger; toasts slide in
- `prefers-reduced-motion` disables every loop and entrance and shortens transitions to 0.01ms; coarse pointers and < 768px drop backdrop sampling on fixed chrome/composer/stats/feed for opaque gradient fallbacks; print flattens to ink on paper

## Imagery and texture
Keep existing brand and content imagery. Ambient light lives in `body::before` (fixed, clipped) and the hero composition; it never sits behind running prose as texture. The blueprint grid appears only in the home figures well.

## Exports
- `app/tokens.css`: canonical Halo token set and Tailwind v4 static utilities
- `app/globals.css`: semantic-role compatibility mapping
- `app/styles/aurora.css`: the Halo material layer (this document's implementation)
- `app/styles/lumen.css`: structural baseline, unchanged
- No DTCG or shadcn export was requested
