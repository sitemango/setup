/** Browser paint validation. axe cannot resolve many gradients, blend modes,
 * canvas backdrops or placeholders. This measures the actual background pixels
 * under text/icon bounds after hiding ONLY ink in the isolated audit browser.
 * It never adds a stylesheet/override to the product or changes a saved file. */
import { PNG } from 'pngjs';

export function luminance(rgb) {
  const c = rgb.slice(0, 3).map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

export function ratio(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

export async function measureViewport(page, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await sampleViewport(page, options); }
    catch (error) {
      if (error.code !== 'stale-render' || attempt === 2) throw error;
      await page.waitForTimeout(250);
    }
  }
}

async function sampleViewport(page, { root = 'body' } = {}) {
  const samples = await page.evaluate((rootSelector) => {
    const rootElement = document.querySelector(rootSelector);
    if (!rootElement) throw new Error(`Missing audit root ${rootSelector}`);
    window.__campusContrastPaint = { changed: false };
    const observer = new MutationObserver(() => { window.__campusContrastPaint.changed = true; });
    observer.observe(rootElement, { childList: true, characterData: true, subtree: true });
    window.__campusContrastPaint.observer = observer;
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (value) => {
      context.clearRect(0, 0, 1, 1);
      // An unsupported paint value must not inherit the previous sample's
      // fillStyle. SVG url(#gradient) paints are resolved to their real stops
      // below before they reach this canvas parser.
      context.fillStyle = '#00000000';
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((channel, i) => i === 3 ? channel / 255 : channel);
    };
    const opacity = (element) => {
      let value = 1;
      for (let current = element; current; current = current.parentElement) value *= Number(getComputedStyle(current).opacity);
      return value;
    };
    const shown = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility === 'visible' && opacity(element) > 0.01 && rect.width > 2 && rect.height > 2 && style.clipPath !== 'inset(50%)';
    };
    const clippedRect = (rect) => {
      const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
      const right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      return { x, y, width: right - x, height: bottom - y };
    };
    const visiblePoints = (rect, element) => {
      const points = [];
      for (const dx of [0.2, 0.5, 0.8]) for (const dy of [0.2, 0.5, 0.8]) {
        const x = rect.x + rect.width * dx, y = rect.y + rect.height * dy;
        const hit = document.elementFromPoint(x, y);
        // Read-only tilt content deliberately lets the pointer through to its
        // inert tracker. Pointer hit-testing is not the same as paint visibility.
        const transparent = getComputedStyle(element).pointerEvents === 'none';
        const sameTilt = transparent && element.closest('.tilt') && hit?.closest('.tilt') === element.closest('.tilt');
        const ancestorHit = transparent && hit?.contains(element);
        // Toasts intentionally let the pointer through, despite painting above
        // ordinary content. Do not confuse that passive interaction contract
        // with invisibility (a foreground modal can still occlude the toast).
        const passiveNotice = transparent && element.closest('.toast') && !document.querySelector('[role="dialog"]');
        if (hit && (hit === element || element.contains(hit) || sameTilt || ancestorHit || passiveNotice)) points.push({ x, y });
      }
      return points;
    };
    const output = [];
    let id = 0;
    const add = (element, text, kind, color, rects, minimum, extraOpacity = 1) => {
      const points = rects.map(clippedRect).filter((rect) => rect.width > 2 && rect.height > 2).flatMap((rect) => visiblePoints(rect, element));
      if (!points.length) return;
      const foregrounds = (Array.isArray(color) ? color : [color]).map(rgba).filter((fg) => fg[3]);
      if (!foregrounds.length) return;
      // A gradient shares one hidden-ink marker and one background capture, but
      // every stop is a separate foreground sample. This measures the worst
      // actual stop instead of letting canvas reuse an unrelated prior color.
      element.dataset.contrastHide = String(id++);
      for (const fg of foregrounds) {
        output.push({ kind, text: text.slice(0, 140), selector: element.tagName.toLowerCase() + (element.className?.baseVal || element.className ? '.' + String(element.className?.baseVal || element.className).trim().replaceAll(' ', '.') : ''), foreground: fg, opacity: opacity(element) * extraOpacity, points, minimum });
      }
    };
    const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, element = node.parentElement;
      if (!element || !node.textContent.trim() || /^(SCRIPT|STYLE|OPTION|TEXTAREA)$/.test(element.tagName) || element.closest('svg, nextjs-portal') || !shown(element)) continue;
      const style = getComputedStyle(element);
      const range = document.createRange(); range.selectNodeContents(node);
      const minimum = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      add(element, node.textContent.trim(), 'text', style.color, [...range.getClientRects()], minimum);
    }
    for (const field of rootElement.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, select')) {
      if (!shown(field)) continue;
      const style = getComputedStyle(field);
      const placeholder = !field.value && field.placeholder;
      const ink = placeholder ? getComputedStyle(field, '::placeholder') : style;
      const r = field.getBoundingClientRect();
      const left = parseFloat(style.paddingLeft) || 0, right = parseFloat(style.paddingRight) || 0;
      const top = field.tagName === 'TEXTAREA' ? parseFloat(style.paddingTop) : Math.max(0, (r.height - parseFloat(style.fontSize) * 1.4) / 2);
      const rect = { x: r.x + left + 2, y: r.y + top + 2, right: r.right - right - 12, bottom: r.y + top + parseFloat(style.fontSize) * 1.3 };
      const text = placeholder || (field.tagName === 'SELECT' ? field.selectedOptions[0]?.text : field.value);
      if (text) add(field, text, placeholder ? 'placeholder' : 'input', ink.color, [rect], 4.5, placeholder ? Number(ink.opacity) : 1);
    }
    for (const svg of rootElement.querySelectorAll('svg:not(.campus-intro__svg)')) {
      if (!shown(svg) || svg.closest('.campus-intro')) continue;
      const shapes = [...svg.querySelectorAll('path, line, circle, rect, polyline')];
      const shape = shapes.find((item) => {
        const style = getComputedStyle(item);
        return Number(style.opacity) > 0.01 && (style.stroke !== 'none' || style.fill !== 'none');
      });
      if (!shape) continue;
      const paint = getComputedStyle(shape);
      const color = paint.stroke !== 'none' ? paint.stroke : paint.fill;
      let colors = [color];
      const paintReference = /^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/.exec(color);
      if (paintReference) {
        const gradient = [...svg.querySelectorAll('linearGradient, radialGradient')].find((item) => item.id === paintReference[1]);
        const stops = [...(gradient?.querySelectorAll('stop') ?? [])].map((stop) => getComputedStyle(stop).stopColor);
        if (stops.length) colors = stops;
      }
      add(svg, svg.parentElement?.getAttribute('aria-label') || svg.className.baseVal || 'Icon', 'icon', colors, [svg.getBoundingClientRect()], 3, Number(paint.opacity));
    }
    return output;
  }, root);

  const style = await page.addStyleTag({ content: `
    [data-contrast-hide] { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }
    [data-contrast-hide]::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; }
    svg[data-contrast-hide], svg[data-contrast-hide] :is(path, line, circle, rect, polyline) { stroke: transparent !important; fill: transparent !important; }
  ` });
  let png;
  let changed = false;
  try {
    png = PNG.sync.read(await page.screenshot({ caret: 'initial', scale: 'css' }));
  } finally {
    changed = await page.evaluate(() => {
      const probe = window.__campusContrastPaint;
      probe.observer.disconnect();
      delete window.__campusContrastPaint;
      return probe.changed;
    });
    await style.evaluate((element) => element.remove());
    await page.locator('[data-contrast-hide]').evaluateAll((elements) => elements.forEach((element) => delete element.dataset.contrastHide));
  }
  if (changed) {
    const error = new Error('UI rerendered during the background paint sample; retry a stable frame.');
    error.code = 'stale-render';
    throw error;
  }
  const results = samples.map((sample) => {
    let worst = Infinity;
    let background;
    for (const point of sample.points) {
      const x = Math.min(png.width - 1, Math.max(0, Math.floor(point.x)));
      const y = Math.min(png.height - 1, Math.max(0, Math.floor(point.y)));
      const index = (y * png.width + x) * 4;
      const bg = [...png.data.subarray(index, index + 3)];
      const alpha = sample.foreground[3] * sample.opacity;
      const fg = sample.foreground.slice(0, 3).map((channel, i) => channel * alpha + bg[i] * (1 - alpha));
      const contrast = ratio(fg, bg);
      if (contrast < worst) { worst = contrast; background = bg; }
    }
    const { points: _points, ...result } = sample;
    return { ...result, contrast: Number(worst.toFixed(3)), background, passed: worst + 0.01 >= sample.minimum };
  });
  return { checked: results.length, worst: Math.min(...results.map((item) => item.contrast)), failures: results.filter((item) => !item.passed), samples: results };
}

/** A focus outline must actually paint outside the control, not be clipped by
 * its own overflow-hidden surface (the original celestial switch failure). */
export async function verifyFocusPaint(page, locator, ringLocator = locator) {
  await page.keyboard.press('Tab');
  await locator.focus();
  // A visually-hidden native input is not the painted focus target. Ensure
  // its associated label is in view before evaluating its ring pixels.
  await ringLocator.scrollIntoViewIfNeeded();
  const style = await ringLocator.evaluate((element) => {
    const s = getComputedStyle(element), rect = element.getBoundingClientRect();
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = s.outlineColor; ctx.fillRect(0, 0, 1, 1);
    return { width: parseFloat(s.outlineWidth), color: [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3), rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom } };
  });
  if (style.width < 2) throw new Error('Focus ring is missing or thinner than 2px');
  const png = PNG.sync.read(await page.screenshot({ caret: 'initial', scale: 'css' }));
  let matching = 0;
  for (let y = Math.max(0, Math.floor(style.rect.y - 6)); y < Math.min(png.height, style.rect.bottom + 6); y += 1) {
    for (let x = Math.max(0, Math.floor(style.rect.x - 6)); x < Math.min(png.width, style.rect.right + 6); x += 1) {
      if (x >= style.rect.x && x <= style.rect.right && y >= style.rect.y && y <= style.rect.bottom) continue;
      const index = (y * png.width + x) * 4;
      if (style.color.every((channel, i) => Math.abs(channel - png.data[index + i]) < 8)) matching += 1;
    }
  }
  const minimum = Math.max(16, (style.rect.right - style.rect.x + style.rect.bottom - style.rect.y) * 0.6);
  if (matching < minimum) throw new Error(`Focus ring is clipped or not painted (${matching} matching pixels; ${JSON.stringify(style)})`);
  return { outlineWidth: style.width, visiblePixels: matching };
}
