/**
 * One WebGL capability probe for every atmospheric canvas.
 *
 * Both the login ghost and the Home depth field need the same question answered
 * before they build a renderer: can this browser give us a context at all?
 * Keeping it in one place means the two scenes cannot drift (and neither can
 * their fallbacks: the answer `false` always means "show the CSS composition").
 *
 * It never throws and never keeps the probe context: the canvas is discarded
 * immediately, so a browser that is at its WebGL context limit is not pushed
 * further by simply asking.
 */

export function webglAvailable() {
  try {
    const probe = document.createElement('canvas');
    const context = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!context) return false;
    // Release the probe context straight away (best effort — the call is
    // optional in the spec and absent in some older browsers).
    context.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}
