import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regression for the measured cold Discussion-tab presentation delay. Keep the
// mobile material opaque while retaining its gradients/rims; backdrop sampling
// on these four visible surfaces made a small state update take several frames.
describe('mobile interaction surfaces', () => {
  it('does not backdrop-sample fixed chrome, the composer, or Home stats', () => {
    const surfaces = fs.readFileSync('app/styles/surfaces.css', 'utf8');
    const touch = surfaces.slice(
      surfaces.indexOf('@media (pointer: coarse), (max-width: 767px)'),
      surfaces.indexOf('@media print'),
    );
    for (const selector of ['.glass-floating', '.glass-premium']) {
      expect(touch).toMatch(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*backdrop-filter: none;`));
    }

    const home = fs.readFileSync('app/styles/home.css', 'utf8');
    expect(home).toMatch(/\.home-pulse__stats\s*\{[^}]*backdrop-filter: none;/);
  });

  it('keeps the phone aurora geometry independent of late real stats', () => {
    const home = fs.readFileSync('app/styles/home.css', 'utf8');
    const phone = home.slice(home.lastIndexOf('@media (max-width: 767px)'));
    expect(phone).toMatch(/\.home-pulse__aurora\s*\{\s*top: -16rem;\s*height: 60rem;/);
  });
});
