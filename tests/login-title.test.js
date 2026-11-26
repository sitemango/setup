import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const loginLayout = read('app/login/layout.js');
const loginPage = read('app/login/page.js');
const loginCss = read('app/styles/login.css');
const globals = read('app/globals.css');

/**
 * The sign-in heading is a poster title: condensed uppercase caps stacked one
 * phrase per line, filling the column. These guards pin the three things that
 * make it work — the route-owned face, the fit-to-measure sizing, and the one
 * deliberate exception in the global heading rule — so a later restyle cannot
 * quietly turn it back into an overflowing serif line.
 */
describe('sign-in poster title', () => {
  it('owns its display face on the login route only', () => {
    // Declared in the route layout, not the root: `next/font` then emits the
    // preload on /login and /login/verify only (audit #3 in docs/performance).
    expect(loginLayout).toContain("import localFont from 'next/font/local'");
    expect(loginLayout).toContain("variable: '--font-poster'");
    expect(loginLayout).toContain('Anton-Regular.woff2');
    expect(read('app/layout.js')).not.toContain('Anton-Regular.woff2');
    // The face is self-hosted with its licence beside it, like every other face.
    expect(fs.existsSync(path.join(ROOT, 'app/fonts/Anton-Regular.woff2'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'app/fonts/Anton-LICENSE.txt'))).toBe(true);
  });

  it('keeps the copy, the heading level and one phrase per line', () => {
    expect(loginPage).toMatch(/<h1 className="login-title mt-3">/);
    expect(loginPage).toContain('<span className="login-title-line">The campus,</span>');
    expect(loginPage).toContain(
      '<span className="login-title-line login-title-accent">in one place</span>',
    );
    // The break is content, not a wrapping accident.
    expect(loginPage).not.toContain('<br');
  });

  it('fits the type to the column instead of guessing breakpoints', () => {
    expect(loginCss).toContain('--login-title-fit:');
    expect(loginCss).toContain('--login-title-scale:');
    expect(loginCss).toContain(
      'font-size: calc(100cqw / var(--login-title-fit) / var(--login-title-scale))',
    );
    // `cqw` only resolves inside a size container, and the login column is it.
    expect(loginCss).toMatch(
      /:root \.login-stage \.login-intro \{\s*container-type: inline-size;/,
    );
    expect(loginCss).toContain('text-transform: uppercase');
    expect(loginCss).toContain('text-wrap: nowrap');
    // One weight only, so the browser never fakes a bolder cut.
    expect(loginCss).toContain('font-synthesis: none');
  });

  it('paints the galactic glass surface across both lines', () => {
    // The layers are clipped to the heading's own glyphs, so the colour travels
    // across the block instead of restarting on the second line.
    expect(loginCss).toContain('background-clip: text');
    expect(loginCss).toContain('-webkit-text-fill-color: transparent');
    // The three Campus+ galaxy stops: ice, the page's paper, warm sand.
    expect(loginCss).toMatch(/--login-title-cool: #A8D8F7;/);
    expect(loginCss).toMatch(/--login-title-warm: #E9C79E;/);
    // The glass: specular layers that repeat once per row of caps.
    expect(loginCss).toContain('--login-title-glint:');
    expect(loginCss).toContain('--login-title-sheen:');
    expect(loginCss).toMatch(/background-repeat: repeat-y, repeat-y, no-repeat;/);
    // The lower line must not start its own surface.
    expect(loginCss).toMatch(
      /:root \.login-stage \.login-title-accent \{[^}]*background-image: none;/,
    );
    // The solid colour stays as the fallback when the clip is unsupported.
    expect(loginCss).toMatch(
      /:root \.login-stage \.login-title \{[^}]*color: var\(--login-tagline\);/,
    );
  });

  it('keeps the galactic stops on the stage so the title rule can share them', () => {
    // Custom properties do not reach a sibling element: the tokens have to be
    // declared on the stage, or `.login-rule` silently drops its gradient.
    const stageBlock = loginCss.match(/:root \.login-stage \{([^}]*--login-title-cool[^}]*)\}/);
    expect(stageBlock).not.toBeNull();
    expect(stageBlock[1]).toContain('--login-title-cool:');
    expect(stageBlock[1]).toContain('--login-title-warm:');
    const rule = loginCss.match(/:root \.login-stage \.login-rule \{([^}]*)\}/);
    expect(rule[1]).toContain('var(--login-title-cool)');
    expect(rule[1]).toContain('var(--login-title-warm)');
  });

  it('is the one deliberate exception to the global heading family', () => {
    // Everything else keeps Geist, including other h1s on public documents.
    expect(globals).toContain('h1:not(.login-title), h2, h3,');
    expect(globals).toContain('font-family: var(--font-body) !important;');
  });
});
