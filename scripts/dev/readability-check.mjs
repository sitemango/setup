#!/usr/bin/env node
/**
 * Readability check (development tool): does the artwork behind the text leave
 * the text readable?
 *
 * The Home page puts an atmospheric field *behind* real content, so token
 * contrast (which `tests/contrast.test.js` and the rendered audit already
 * cover) is not the whole story: what a student reads is the composite — the
 * canvas' contours, the CSS ridge fallback, the aurora, the wash — with glyphs
 * on top of it. What has to be watched is the field itself: it draws luminous
 * contour lines on a near-black ground, which is exactly the direction that
 * eats the contrast of light text when a ridge brightens behind a glyph.
 *
 * How it measures, and why this way:
 *   - the ink is the element's **declared** colour (`getComputedStyle().color`).
 *     Glyph antialiasing only ever blends the ink toward the paper, so the
 *     declared colour is the real (best) ink, and sampling "the darkest pixels"
 *     would just re-measure antialiasing;
 *   - the paper is a real screenshot of the element's own box taken while the
 *     text layer is hidden (`visibility: hidden`) and the environment keeps
 *     running — so the sample is exactly what the words sit on, with no glyph
 *     pixel able to pollute it — repeated across several frames so the number
 *     covers the moving contours rather than one lucky instant;
 *   - the reported ratio is the WORST of those samples, i.e. the moment and
 *     place where the environment competes most with the words.
 *
 *   node scripts/dev/readability-check.mjs [--url http://127.0.0.1:3300] [--only dark]
 *
 * Exit code is non-zero when any measured pair falls below its target.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { launchBrowser } from './browser.mjs';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    out: { type: 'string' },
    only: { type: 'string' },
    frames: { type: 'string' },
    'no-webgl': { type: 'boolean' },
  },
  allowPositionals: true,
});

const BASE = (values.url || process.env.PREVIEW_URL || 'http://127.0.0.1:3300').replace(/\/$/, '');
const OUT = path.resolve(values.out || path.join('..', 'readability-report'));
const FRAMES = Number(values.frames || 3);

/**
 * The text that has to survive the environment, and what it must clear.
 *
 * The minimums are WCAG 2.1 AA's, applied per element rather than as one flat
 * number: 4.5:1 for body-size text, 3:1 for the display-size greeting name
 * (whose ink is a clipped gradient, so this is also the only measurement here
 * taken from pixels rather than from a declared colour).
 */
const TARGETS = [
  { name: 'greeting (h1)', selector: '.home-pulse__title', min: 4.5 },
  { name: 'greeting name', selector: '.home-pulse__name', min: 3 },
  { name: 'lead line', selector: '.home-pulse__lead', min: 4.5 },
  { name: 'eyebrow', selector: '.home-pulse__eyebrow', min: 4.5 },
  { name: 'stat labels', selector: '.home-pulse__stat dt', min: 4.5 },
  { name: 'stat values', selector: '.home-pulse__stat dd', min: 4.5 },
  { name: 'zone title', selector: '.home-zone__title', min: 4.5 },
  { name: 'zone note', selector: '.home-zone__note', min: 4.5 },
  { name: 'rail eyebrow', selector: '.island__eyebrow', min: 4.5 },
  { name: 'rail note', selector: '.island__note', min: 4.5 },
];

/* ── colour maths ─────────────────────────────────────────────────────────── */

const toLinear = (channel) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ({ r, g, b }) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const parseRgb = (value) => {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) return null;
  const [r, g, b] = match[1].split(',').map((part) => Number.parseFloat(part));
  return { r, g, b };
};

/**
 * Estimate the glyph colour of an element from pixels — used only when the ink
 * is an image (`background-clip: text` reports `transparent`).
 *
 * Glyphs are whatever stands out from the paper, in whichever direction the
 * theme paints them (light ink on the dark theme, dark ink on the light one), so
 * both extreme ends are measured and the one with more contrast against the
 * sampled paper is taken. Averaging the single darkest decile would have just
 * measured the dark background on the dark theme — which is how this check first
 * reported a 1.04:1 "failure" for text that reads perfectly well.
 */
function glyphInk(png, x0, y0, x1, y1, paper) {
  const pixels = [];
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(png.width, x1); x += 1) {
      const i = (png.width * y + x) << 2;
      const pixel = { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
      pixels.push({ pixel, l: luminance(pixel) });
    }
  }
  if (pixels.length < 40) return null;
  pixels.sort((a, b) => a.l - b.l);
  const take = Math.max(6, Math.round(pixels.length * 0.02));
  const mean = (list) => {
    const sum = list.reduce(
      (acc, item) => ({ r: acc.r + item.pixel.r, g: acc.g + item.pixel.g, b: acc.b + item.pixel.b }),
      { r: 0, g: 0, b: 0 },
    );
    return { r: Math.round(sum.r / list.length), g: Math.round(sum.g / list.length), b: Math.round(sum.b / list.length) };
  };
  const darkest = mean(pixels.slice(0, take));
  const brightest = mean(pixels.slice(-take));
  return contrast(darkest, paper) >= contrast(brightest, paper) ? darkest : brightest;
}

/** Mean colour of a rectangle in a screenshot. */
function mean(png, x0, y0, x1, y1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(png.width, x1); x += 1) {
      const i = (png.width * y + x) << 2;
      r += png.data[i];
      g += png.data[i + 1];
      b += png.data[i + 2];
      n += 1;
    }
  }
  if (!n) return null;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/* ── the run ──────────────────────────────────────────────────────────────── */

async function measure(browser, scheme) {
  mkdirSync(OUT, { recursive: true });
  const suffix = values['no-webgl'] ? '-no-webgl' : '';
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: scheme,
    deviceScaleFactor: 1,
  });
  await context.addCookies([
    { name: 'campus_intro', value: '1', url: BASE },
  ]);
  const page = await context.newPage();
  if (values['no-webgl']) {
    // The finished CSS composition is what a browser without WebGL sees, and it
    // is painted by tokens rather than by the scene, so it has to be measured
    // with the same rig rather than assumed to match.
    await page.addInitScript(() => {
      const fail = () => null;
      HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
        apply(target, self, args) {
          if (String(args[0]).startsWith('webgl')) return fail();
          return Reflect.apply(target, self, args);
        },
      });
    });
  }
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1400);

  const targets = await page.evaluate((list) => {
    const out = [];
    for (const target of list) {
      const el = document.querySelector(target.selector);
      if (!el) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) continue;
      out.push({
        name: target.name,
        min: target.min,
        ink: getComputedStyle(el).color,
        rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    }
    return out;
  }, TARGETS);

  // A gradient-clipped element (`background-clip: text`) paints its glyphs with
  // an image and reports `transparent` as its colour, so its ink can only come
  // from pixels. Every other element declares the exact ink it paints with.
  const INVISIBLE_INK = /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/;

  const samples = new Map();
  for (let frameIndex = 0; frameIndex < FRAMES; frameIndex += 1) {
    // 1. With the words on screen: the only way to read a clipped-gradient ink.
    const shown = PNG.sync.read(await page.screenshot({ fullPage: false }));
    if (frameIndex === 0) {
      writeFileSync(path.join(OUT, `home-${scheme}${suffix}.png`), await page.screenshot({ fullPage: false }));
    }
    // 2. With the text layer hidden but the environment running: the exact
    //    pixels the glyphs sit on, with no glyph pixel able to pollute them.
    await page.evaluate((selectors) => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) el.style.visibility = 'hidden';
      }
    }, TARGETS.map((target) => target.selector));
    await page.waitForTimeout(140);
    const hidden = PNG.sync.read(await page.screenshot({ fullPage: false }));
    await page.evaluate((selectors) => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) el.style.removeProperty('visibility');
      }
    }, TARGETS.map((target) => target.selector));

    for (const target of targets) {
      const box = {
        x: Math.floor(target.rect.x),
        y: Math.floor(target.rect.y),
        x1: Math.ceil(target.rect.x + target.rect.width),
        y1: Math.ceil(target.rect.y + target.rect.height),
      };
      const paper = mean(hidden, box.x, box.y, box.x1, box.y1);
      const glyph =
        INVISIBLE_INK.test(target.ink) && paper ? glyphInk(shown, box.x, box.y, box.x1, box.y1, paper) : null;
      const ink = glyph || parseRgb(target.ink);
      if (!paper || !ink) continue;
      const ratio = contrast(ink, paper);
      const current = samples.get(target.name);
      if (!current || ratio < current.ratio) {
        samples.set(target.name, {
          ratio,
          ink: glyph ? `rgb(${ink.r}, ${ink.g}, ${ink.b}) (measured; gradient glyphs)` : target.ink,
          paper: `rgb(${paper.r}, ${paper.g}, ${paper.b})`,
          inkSource: glyph ? 'pixels' : 'declared',
        });
      }
    }
    await page.waitForTimeout(520);
  }

  await context.close();

  return targets.map((target) => {
    const worst = samples.get(target.name);
    return {
      scheme,
      name: target.name,
      ratio: worst ? Number(worst.ratio.toFixed(2)) : null,
      min: target.min,
      ink: worst?.ink || target.ink,
      inkSource: worst?.inkSource || 'declared',
      paper: worst?.paper || null,
      frames: FRAMES,
      ok: Boolean(worst) && worst.ratio >= target.min,
    };
  });
}

const browser = await launchBrowser();
const schemes = values.only ? [values.only] : ['dark'];
const report = { base: BASE, at: new Date().toISOString(), rows: [] };

console.log('\nMeasured composite contrast on /home — declared ink vs the real pixels behind it\n');
for (const scheme of schemes) {
  const rows = await measure(browser, scheme);
  report.rows.push(...rows);
  console.log(`  ${scheme}`);
  for (const row of rows) {
    const mark = row.ok ? '\x1b[32mok\x1b[39m  ' : '\x1b[31mFAIL\x1b[39m';
    console.log(`    ${mark} ${row.name.padEnd(18)} ${String(row.ratio).padStart(6)}:1  (min ${row.min})  ${row.ink} on ${row.paper}`);
  }
}
await browser.close();

const failures = report.rows.filter((row) => !row.ok);
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'readability-report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.rows.length - failures.length}/${report.rows.length} measured pairs meet their target`);
console.log(`report: ${path.join(OUT, 'readability-report.json')}\n`);
process.exit(failures.length ? 1 : 0);
