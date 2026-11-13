import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnimatedStat } from '@/components/home/AnimatedStat';

const read = (path) => fs.readFileSync(path, 'utf8');

describe('contained motion refresh', () => {
  it('server-renders the real statistic with one stable accessible value', () => {
    for (const value of [0, 137]) {
      const html = renderToStaticMarkup(React.createElement(AnimatedStat, { value }));
      expect(html).toContain(`<span class="sr-only">${value}</span>`);
      expect(html).toContain(`<span aria-hidden="true">${value}</span>`);
    }
    const source = read('components/home/AnimatedStat.js');
    expect(source).toContain('prefers-reduced-motion: no-preference');
    expect(source).toContain('cancelAnimationFrame');
    expect(source).toContain('media.removeEventListener');
  });

  it('limits decorative motion on mobile and for reduced motion', () => {
    const shell = read('app/styles/shell-frame.css');
    const home = read('app/styles/home-dashboard.css');
    const market = read('app/styles/market-grid.css');
    expect(shell).toContain('(min-width: 768px) and (prefers-reduced-motion: no-preference)');
    expect(home).toContain('(min-width: 768px) and (prefers-reduced-motion: no-preference)');
    expect(market).toContain('(hover: hover) and (prefers-reduced-motion: no-preference)');
    expect(market).toContain('.market-product:hover .market-cover__image');
    expect(read('components/layout/ShellFrame.js')).toContain('(min-width: 768px) and (prefers-reduced-motion: no-preference)');
  });
});
