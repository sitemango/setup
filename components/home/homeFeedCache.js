import { dedupeFeed, sortFeed } from '@/lib/social/feed-state';

/**
 * Small, browser-memory-only cache for the signed-in student's Home feed.
 *
 * It holds the page (or pages) the surface actually has, deduplicated and
 * newest-first, so a remount inside the TTL window paints the same list the reader
 * was looking at. It is deliberately not localStorage/sessionStorage and must only be
 * imported by client modules.
 */
/**
 * How long a stored page may be served before a surface must re-read.
 *
 * It is a first-paint optimisation, not a staleness budget: every path that can
 * change the feed — a publish, a delete, a moderation change, a Realtime event, a
 * reconnect — clears or patches this cache and forces a re-read, so nothing has to
 * wait for the window to expire to see the truth.
 */
export const HOME_FEED_CACHE_TTL_MS = 15_000;
const MAX_CACHED_USERS = 3;
const cache = new Map();
const listeners = new Map();

/**
 * Deduplicate and order a feed payload for storage.
 *
 * The rules live in `lib/social/feed-state.js`, shared with the live provider, the
 * Home stream and the write path, so a cached page, an optimistic insert and a
 * Realtime reconcile can never disagree about which two entries are the same post.
 *
 * There used to be a window applied here as well — ten entries, oldest evicted — which
 * is why Home could not show more than ten posts however many the request asked for.
 * The surface owns every page it has loaded now, so the cache stores exactly that and
 * no more: dedup and ordering, no slice. What bounds memory is the reader (older pages
 * are fetched on request) and `MAX_CACHED_USERS`.
 */
export function prepareHomeFeed(items) {
  return sortFeed(dedupeFeed(Array.isArray(items) ? items : []));
}

export function readHomeFeedCache(userId) {
  if (!userId) return null;
  const entry = cache.get(String(userId));
  if (!entry) return null;

  return {
    payload: entry.payload,
    fresh: Date.now() - entry.storedAt < HOME_FEED_CACHE_TTL_MS,
    // The shell-wide revision the live feed was at when this page was stored. A
    // surface must only reuse a page whose revision still matches (see
    // `components/layout/LiveFeedProvider`): that is what makes a page stale the
    // instant a post lands, including while no feed surface is mounted to notice.
    revision: entry.revision,
  };
}

/**
 * Store the authoritative newest-first response — every page the surface holds.
 *
 * `revision` is the live-feed revision this page reflects, so a later change
 * anywhere in the app can mark it stale without deleting it (a stale page is still
 * a first paint; it just has to be re-read).
 */
export function writeHomeFeedCache(userId, payload, revision = 0) {
  if (!userId || !payload || !Array.isArray(payload.feed)) return payload;

  const key = String(userId);
  const next = { ...payload, feed: prepareHomeFeed(payload.feed) };
  cache.delete(key);
  cache.set(key, { payload: next, storedAt: Date.now(), revision });

  // A few accounts at most can be remembered in a long-lived browser tab.
  while (cache.size > MAX_CACHED_USERS) {
    cache.delete(cache.keys().next().value);
  }

  return next;
}

/**
 * Apply a local change to the stored payload without waiting for the network.
 *
 * This is what keeps an author's own post on screen across a client navigation
 * inside the TTL window: the entry is patched in place under the same dedup and
 * ordering rules a server response goes through, so a remount hydrates from a cache
 * that already knows about the row instead of rolling the feed back to whatever was
 * fetched a quarter-minute ago. The forced refetch that follows reconciles it with
 * the authoritative page.
 *
 * A patch for a user with nothing stored is a no-op — this must never create an
 * entry for somebody else's feed, and it never invents a payload.
 */
export function patchHomeFeedCache(userId, update, revision = null, { notify = true } = {}) {
  if (!userId || typeof update !== 'function') return null;
  const key = String(userId);
  const entry = cache.get(key);
  if (!entry) return null;
  const next = writeHomeFeedCache(userId, update(entry.payload), revision == null ? entry.revision : revision);
  if (next && notify) {
    // A vote can settle after its original card/page has unmounted. Notify the
    // currently mounted Home as well as updating memory so rollback and
    // reconciliation cannot strand an optimistic snapshot on a navigation return.
    for (const listener of listeners.get(key) || []) {
      try {
        listener(next);
      } catch {
        // One unmounted/stale listener must not prevent the cache patch itself.
      }
    }
  }
  return next;
}

/** Listen only to explicit local patches, not every network write. */
export function subscribeHomeFeedCache(userId, listener) {
  if (!userId || typeof listener !== 'function') return () => {};
  const key = String(userId);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(listener);
  return () => {
    const group = listeners.get(key);
    group?.delete(listener);
    if (!group?.size) listeners.delete(key);
  };
}

export function clearHomeFeedCache(userId) {
  if (userId) cache.delete(String(userId));
}
