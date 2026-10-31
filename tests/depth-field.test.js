import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DepthField, shouldUseStaticDepthField } from '@/components/atmosphere/DepthField';

describe('Home depth-field device policy', () => {
  it('keeps the full scene only for a capable, unconstrained desktop path', () => {
    expect(shouldUseStaticDepthField()).toBe(false);
    expect(shouldUseStaticDepthField({ reducedMotion: false, coarse: false, narrow: false, saveData: false })).toBe(false);
  });

  it('uses the finished CSS composition for phone, reduced-motion, and data-saving paths', () => {
    for (const input of [
      { coarse: true },
      { narrow: true },
      { reducedMotion: true },
      { saveData: true },
    ]) {
      expect(shouldUseStaticDepthField(input)).toBe(true);
    }
  });

  it('checks the static policy and WebGL capability before importing Three', () => {
    const source = fs.readFileSync('components/atmosphere/DepthField.js', 'utf8');
    const dynamicImport = source.indexOf("import('./depth/createDepthField')");
    expect(source.indexOf('if (staticField || !webglAvailable()) return undefined;')).toBeLessThan(dynamicImport);
    expect(source.indexOf('shouldUseStaticDepthField({')).toBeLessThan(dynamicImport);
  });

  it('server-renders the CSS atmosphere instead of an empty loading band', () => {
    const html = renderToStaticMarkup(React.createElement(DepthField));
    expect(html).toContain('data-state="fallback"');
    expect(html).toContain('depth-field__fallback');
    expect(html).toContain('depth-field__ridge--far');
    expect(html).toContain('depth-field__horizon');
    expect(html).not.toContain('<canvas');
  });
});
