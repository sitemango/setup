import { webglAvailable } from '@/components/atmosphere/webgl';

// Probe away from the UI thread: creating even a test context can synchronously
// initialize a software renderer. The worker is short-lived and owns no scene.
const WORKER_SOURCE = `
self.onmessage = () => {
  let ok = false;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const options = { failIfMajorPerformanceCaveat: true };
    const gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '';
      ok = !/swiftshader|llvmpipe|softpipe|software rasterizer/i.test(renderer || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch (_) {}
  self.postMessage(ok);
};`;

/** Start a cancellable probe; browsers without worker canvas retain the old probe. */
export function probeGhostWebGL() {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return { result: Promise.resolve().then(() => webglAvailable({ requireHardware: true })), cancel() {} };
  }

  let worker;
  let url;
  let timer;
  let finish;
  const result = new Promise((resolve) => {
    let done = false;
    finish = (supported) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      resolve(supported);
    };
    try {
      url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (event) => finish(event.data === true);
      worker.onerror = () => finish(false);
      timer = setTimeout(() => finish(false), 8000);
      worker.postMessage(null);
    } catch {
      finish(false);
    }
  });
  return { result, cancel: () => finish(false) };
}
