/**
 * The first-visit flag — one boolean, kept on the device.
 *
 * Deliberately not a database column: the question "has this student seen the
 * guide on this phone" is a device question, not an account one (a shared lab
 * machine and a personal phone have different answers, and neither is the
 * student's business to broadcast). Nothing is written to a server, nothing is
 * read cross-device, and clearing site data resets it — which is the correct
 * behaviour for a first-visit hint and the reason no migration was added.
 *
 * The helpers are pure and take the storage object, so a browser that refuses
 * `localStorage` (private mode, blocked third-party storage, a locked-down
 * WebView) is an *expected* case in the tests rather than an exception thrown in
 * an effect: `readGuideSeen` answers `null` for "cannot know", and the UI decides
 * what that means instead of crashing on it.
 */

/** One key, namespaced like the timetable's own storage keys. */
export const GUIDE_SEEN_KEY = 'campusplus:guide-seen';

/**
 * A pre-hydration style, not another preference or a server-rendered guess.
 * Home emits the offer with its first HTML so a new device never shifts the
 * feed when React arrives. Existing devices hide that SSR offer before its
 * first paint; useSyncExternalStore then removes the hidden node normally.
 * Keeping the storage read here also keeps the key and its legacy-value rules
 * in one module. The script is static and contains no account or user data.
 */
export const GUIDE_SEEN_STYLE_ID = 'campusplus-guide-seen-prehydration';
export const GUIDE_SEEN_PREHYDRATION_SCRIPT = `try{const v=window.localStorage.getItem(${JSON.stringify(GUIDE_SEEN_KEY)});if(v!==null&&v!==''&&v!=='0'){const s=document.createElement('style');s.id=${JSON.stringify(GUIDE_SEEN_STYLE_ID)};s.textContent='.guide-strip{display:none!important}';document.head.appendChild(s)}}catch{}`;

/**
 * @param {Storage|undefined|null} storage usually `window.localStorage`
 * @returns {boolean|null} `true` when the guide has been opened or dismissed on
 *   this device, `false` when storage works and it has not, `null` when the
 *   question cannot be answered because storage is unavailable or unreadable.
 */
export function readGuideSeen(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const value = storage.getItem(GUIDE_SEEN_KEY);
    if (value === null || value === undefined) return false;
    // Any value we can read counts as "seen": a timestamp written by an older
    // build must not turn the nag back on.
    return value !== '' && value !== '0';
  } catch {
    return null;
  }
}

/**
 * Remember the answer. Safe to call when storage is unavailable.
 * @returns {boolean} whether the choice was actually kept
 */
export function markGuideSeen(storage, stamp = new Date().toISOString()) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(GUIDE_SEEN_KEY, stamp);
    return true;
  } catch {
    // Quota exceeded or a blocked area: the guide still closed, it will just
    // offer itself again. No throw escapes into a click handler.
    return false;
  }
}

/** Forget the answer, so the strip can be re-armed from Settings-like places. */
export function clearGuideSeen(storage) {
  if (!storage || typeof storage.removeItem !== 'function') return false;
  try {
    storage.removeItem(GUIDE_SEEN_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * The device's own storage, or `null` when even touching it is refused.
 *
 * A blocked `localStorage` does not always announce itself as a failing `getItem`:
 * a locked-down WebView and some private-mode builds throw on the *property read*,
 * so every caller has to ask through this and never reach for `window.localStorage`
 * itself. The answer is an expectation, not a guarantee — the guide's UI keeps
 * working when it is `null`, and says "for now" instead of promising persistence.
 */
export function deviceStorage() {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * Should Home offer the guide?
 *
 * `seen === true` never shows. Unknown (`null`) shows once per load rather than
 * never showing: a student in a private window is exactly the person who may
 * want it, and the strip is one line above the feed, not a modal.
 *
 * `onHome` defaults to false on purpose. "Where is this component mounted?" is the
 * host's question, and a caller that forgets to answer it should get silence
 * rather than a strip on every page.
 */
export function shouldOfferGuide({ seen, onHome = false, hidden = false } = {}) {
  if (!onHome || hidden) return false;
  return seen !== true;
}
