// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ probe: vi.fn(), create: vi.fn(), dispose: vi.fn() }));
vi.mock('@/components/atmosphere/ghost/probe', () => ({ probeGhostWebGL: mocks.probe }));
vi.mock('@/components/atmosphere/ghost/createGhostScene', () => ({ createGhostScene: mocks.create }));
import { GhostScene } from '@/components/atmosphere/GhostScene';

let root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ghost scene startup', () => {
  it('renders the fallback immediately, defers probing, and disposes a hardware scene', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mocks.probe.mockReset().mockReturnValue({ result: Promise.resolve(true), cancel: vi.fn() });
    mocks.create.mockReset().mockReturnValue(mocks.dispose);
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(React.createElement(GhostScene)));
    expect(container.querySelector('.login-ghost-fallback')).toBeTruthy();
    expect(mocks.probe).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mocks.probe).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-state="webgl"]')).toBeTruthy();
    await act(async () => root.unmount());
    root = null;
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it('does not probe after unmounting before the deferred start', async () => {
    vi.useFakeTimers();
    mocks.probe.mockReset();
    const container = document.createElement('div');
    root = createRoot(container);
    await act(async () => root.render(React.createElement(GhostScene)));
    await act(async () => root.unmount());
    root = null;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.probe).not.toHaveBeenCalled();
  });
});
