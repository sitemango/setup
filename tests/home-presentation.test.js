import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HomePulse } from '@/components/home/HomePulse';

// The real search form's router is exercised by the browser check. Server
// rendering here only needs the existing search entry's position in the hero.
vi.mock('@/components/search/SearchEntry', () => ({ SearchEntry: () => null }));

const read = (file) => fs.readFileSync(file, 'utf8');
const profile = {
  display_name: 'Yash Patil',
  username: 'yash_p',
  branch: 'Computer Engineering',
  show_branch_year: true,
};
const render = (props = {}) => renderToStaticMarkup(React.createElement(HomePulse, {
  user: { profile },
  ...props,
}));

describe('Home presentation refinement', () => {
  it('renders a compact personalized introduction without academic data or decoration', () => {
    const html = render();
    expect(html).toContain('aria-labelledby="home-greeting"');
    expect(html).toContain('PCCOE · CAMPUS FEED');
    expect(html).toContain('<span class="home-pulse__greet">Hey,</span>');
    expect(html).toContain('title="Yash">Yash</span>.');
    expect(html).toContain('Here&#x27;s what&#x27;s happening around campus today.');
    expect(html).not.toContain('Computer Engineering');
    expect(html).not.toContain('Wave hello');
    expect(html).not.toContain('Explore campus');
    expect(html).not.toContain('home-pulse__spark');
  });

  it('falls back to the username and does not expose branch information', () => {
    const html = render({ user: { profile: { ...profile, display_name: '', username: 'meera_j' } } });
    expect(html).toContain('title="meera_j">meera_j</span>.');
    expect(html).not.toContain('Computer Engineering');
  });

  it('renders only supplied statistics, with equal tracks for their actual count', () => {
    expect(render()).not.toContain('<dl');
    const stats = [{ label: 'Posts in feed', value: 10 }, { label: 'Notices published', value: 3 }];
    const html = render({ stats });
    expect(html).toContain('style="--home-stat-count:2"');
    expect(html).toContain('aria-label="Campus right now"');
    expect(html).toContain('<dt>Posts in feed</dt><dd><span class="sr-only">10</span><span aria-hidden="true">10</span></dd>');
    expect(html).not.toContain('Market listings');
    expect(render({ stats: [{ label: 'Posts in feed', value: 0 }] })).toContain('data-empty="true"');
  });

  it('uses real local bold weights, a centered non-wrapping heading, and shared columns', () => {
    const css = read('app/styles/home.css');
    const layout = read('app/layout.js');
    expect(layout).toContain("{ path: './fonts/Geist-Bold.woff2', weight: '700', style: 'normal' }");
    expect(layout).toContain("{ path: './fonts/Geist-SemiBold.woff2', weight: '600', style: 'normal' }");
    expect(css).toMatch(/\.home-pulse__name\s*\{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*flex-wrap: nowrap;[^}]*font-weight: 700;/);
    expect(css.match(/grid-template-columns: var\(--home-columns\)/g)).toHaveLength(2);
    expect(css).toContain('@container home-page (min-width: 52rem)');
    expect(css).toContain('@container home-hero (max-width: 21rem)');
    expect(css).not.toContain('!important');
  });
});
