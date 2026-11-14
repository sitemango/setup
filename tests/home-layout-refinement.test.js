import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(file, 'utf8');
const css = read('app/styles/home-dashboard.css');

describe('Home layout refinement', () => {
  it('loads the composition sheet only on Home and its development preview', () => {
    for (const layout of [
      'app/(shell)/(app)/home/layout.js',
      'app/home-preview/layout.js',
    ]) {
      expect(read(layout)).toContain("import '@/app/styles/home-dashboard.css';");
    }
    expect(read('app/globals.css')).not.toContain('home-dashboard.css');
    expect(read('app/layout.js')).not.toContain('home-dashboard.css');
  });

  it('stacks the real greeting and keeps the wave beside the name', () => {
    expect(css).toMatch(/\.home-stage \.home-pulse__greet\s*\{[^}]*display: block;[^}]*font-weight: 700;/);
    expect(css).toMatch(/\.home-stage \.home-pulse__name\s*\{[^}]*display: flex;[^}]*align-items: center;[^}]*margin: 0\.125rem 0 0;[^}]*font-weight: 700;/);
    expect(css).toMatch(/\.home-stage \.home-pulse__name \.home-pulse__wave\s*\{[^}]*width: 2\.75rem;[^}]*height: 2\.75rem;/);
    expect(css).toMatch(/\.home-stage \.home-pulse__lead\s*\{[^}]*margin-top: 0\.625rem;/);
  });

  it('removes the major section boxes while keeping interactive entry surfaces', () => {
    for (const section of ['.home-pulse', '.home-composer', '.rail-island']) {
      expect(css).toMatch(new RegExp(`\\.home-stage \\${section}\\s*\\{[^}]*border: 0;[^}]*border-radius: 0;[^}]*background: transparent;[^}]*box-shadow: none;`));
    }
    expect(css).toMatch(/\.home-stage \.stream-card\s*\{[^}]*border-radius: var\(--radius-md\);/);
    expect(css).toMatch(/\.home-stage \.home-composer__open\s*\{[^}]*border-radius: var\(--radius-sm\);/);
    expect(css).toMatch(/\.home-stage \.feature-tile\s*\{[^}]*border-radius: var\(--radius-xs\);/);
  });

  it('uses a 1px white fade between major sections and between present rail modules', () => {
    expect(css).toMatch(/--home-separator: linear-gradient\(\s*90deg,\s*transparent 0%,\s*rgba\(255, 255, 255, 0\.12\) 15%,\s*rgba\(255, 255, 255, 0\.24\) 50%,\s*rgba\(255, 255, 255, 0\.12\) 85%,\s*transparent 100%\s*\)/);
    expect(css).toMatch(/\.home-stage \.home-pulse::after,\s*:root \.home-stage \.home-composer::after\s*\{[^}]*height: 1px;[^}]*background: var\(--home-separator\);/);
    expect(css).toMatch(/\.home-stage \.rail-island::after\s*\{[^}]*height: 1px;[^}]*background: var\(--home-separator\);/);
    expect(css).toContain('.home-stage .rail-island--market::after');
    expect(css).toContain('.home-stage .home-body__rail:not(:has(.rail-island--market)) .rail-island--events::after');
  });

  it('preserves the two-column breakpoint and stacks below it', () => {
    expect(css).toMatch(/@media \(min-width: 1100px\)\s*\{\s*:root \.home-stage \.home-body\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(15rem, 19rem\);/);
    expect(css).toMatch(/:root \.home-stage \.home-body\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/:root \.home-stage \.home-body__rail\s*\{[^}]*position: static;[^}]*overflow: visible;/);
  });

  it('scopes shared primitive overrides to the Home stage', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((chunk) => chunk.slice(0, chunk.indexOf('{')).trim())
      .filter((selector) => selector && !selector.startsWith('@'));
    for (const selector of selectors) {
      expect(selector).toMatch(/\.home-stage|home-explore-flow|^\d+%,?|^from$|^to$/);
    }
  });
});
