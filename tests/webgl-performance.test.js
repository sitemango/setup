import { afterEach, describe, expect, it, vi } from 'vitest';
import { webglAvailable } from '@/components/atmosphere/webgl';

afterEach(() => vi.unstubAllGlobals());

describe('decorative WebGL capability check', () => {
  function browser(renderer, available = true) {
    const loseContext = vi.fn();
    const context = {
      getExtension: (name) => name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 42 } : { loseContext },
      getParameter: () => renderer,
    };
    const getContext = vi.fn(() => available ? context : null);
    vi.stubGlobal('document', { createElement: () => ({ getContext }) });
    return { getContext, loseContext };
  }
  it('rejects software renderers for the expensive ghost and releases the probe', () => {
    const { getContext, loseContext } = browser('ANGLE (Google, Vulkan SwiftShader Device)');
    expect(webglAvailable({ requireHardware: true })).toBe(false);
    expect(getContext).toHaveBeenCalledWith('webgl2', { failIfMajorPerformanceCaveat: true });
    expect(loseContext).toHaveBeenCalledOnce();
  });
  it('keeps hardware rendering and accepts unknown renderers', () => {
    browser('ANGLE (Apple GPU)');
    expect(webglAvailable({ requireHardware: true })).toBe(true);
    browser('');
    expect(webglAvailable({ requireHardware: true })).toBe(true);
  });
  it('handles an unavailable context', () => {
    browser('', false);
    expect(webglAvailable({ requireHardware: true })).toBe(false);
  });
});

describe('worker probe lifecycle', () => {
  it('cleans up after a result and supports cancellation', async () => {
    const { probeGhostWebGL } = await import('@/components/atmosphere/ghost/probe');
    const instances = [];
    class FakeWorker {
      constructor() { this.terminate = vi.fn(); instances.push(this); }
      postMessage() {}
    }
    const revoke = vi.fn();
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: revoke });
    const first = probeGhostWebGL();
    instances[0].onmessage({ data: true });
    expect(await first.result).toBe(true);
    expect(instances[0].terminate).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:test');
    const second = probeGhostWebGL();
    second.cancel();
    expect(await second.result).toBe(false);
    expect(instances[1].terminate).toHaveBeenCalledOnce();
  });
});
