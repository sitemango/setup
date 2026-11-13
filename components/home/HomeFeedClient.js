'use client';

import { HomeFeedNavigation } from '@/components/home/HomeFeedNavigation';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HOME_FEED_PAGE_SIZE, HOME_FEED_RECONCILE_LIMIT, ROUTES } from '@/lib/constants';
import { Button, CascadeLoader, EmptyState, Notice, WordLoader } from '@/components/ui';
import { HomeComposer } from '@/components/home/HomeComposer';
import { IslandMotion } from '@/components/home/IslandMotion';
import { HomeInstallCard } from '@/components/install/HomeInstallCard';
import { HomePulse, HomeZone } from '@/components/home/HomePulse';
import { StreamItem, StreamSlot } from '@/components/home/StreamItem';
import { HomeRail } from '@/components/home/HomeRail';
import { FollowingFeed } from '@/components/home/FollowingFeed';
import {
  clearHomeFeedCache,
  patchHomeFeedCache,
  readHomeFeedCache,
  subscribeHomeFeedCache,
  writeHomeFeedCache,
} from '@/components/home/homeFeedCache';
import { useLiveFeed } from '@/components/layout/LiveFeedProvider';
import {
  feedPostIds,
  findRemovedFeedPostIds,
  isCampusFeedEligible,
  mergeFeedPages,
  placePostInFeed,
  postToFeedItem,
  reconcileFeed,
  removePostFromFeed,
} from '@/lib/social/feed-state';
import { patchFeedPoll, reconcileFeedPollOverlays } from '@/lib/social/poll-state';

/**
 * A live change is folded into at most one re-read per window, and that window is
 * the provider's own batch on top of this one: a burst of posts, a mention fan-out
 * and a reconnect reconcile all land as a single request instead of a queue.
 */
const LIVE_REFRESH_MS = 700;
/**
 * Someone else's like or comment does not produce a feed Realtime event: the
 * channel deliberately drops counter-only `posts` updates so a busy campus
 * cannot make every open tab re-query. A visible Home therefore re-reads once a
 * minute through the same coalesced refresh path — one request at most, and
 * only while the tab is actually being looked at.
 */
const TRENDING_REFRESH_MS = 60_000;
/**
 * How long a locally placed post may be held onto when the server page has not
 * caught up with it. Long enough to survive a slow revalidation, short enough that
 * a row the feed genuinely excludes (blocked between the write and the read, say)
 * cannot camp on screen: after this, the server page is the whole truth again.
 */
const HELD_POST_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;

/** A stalled request is an error, not evidence that content is ready. The
 * timeout only releases the loader into the visible retry state below. */
async function fetchEssentialFeed(input, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function FeedSkeleton() {
  return (
    <div className="home-feed-loading" aria-busy="true">
      <div className="home-feed-loading__status">
        <WordLoader words={['feed', 'posts', 'notices', 'campus']} />
        <CascadeLoader label="Loading campus feed" />
      </div>
      <div className="home-stream" aria-label="Loading campus feed">
        <span className="sr-only">Loading the latest campus posts and campus rail.</span>
        {[0, 1, 2].map((row) => (
          <div key={row} className="stream-slot" aria-hidden="true">
            <div className="stream-card stream-card--post p-4">
              <div className="flex items-center gap-3">
                <span className="h-8 w-8 rounded-full bg-surface-2" />
                <span className="h-3 w-28 rounded bg-surface-2" />
              </div>
              <span className="mt-4 block h-3 w-full max-w-lg rounded bg-surface-2" />
              <span className="mt-2 block h-3 w-3/4 rounded bg-surface-2" />
              <span className="mt-5 block h-7 w-24 rounded-full bg-surface-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RailSkeleton() {
  return (
    <aside className="home-body__rail" aria-hidden="true">
      {[0, 1].map((row) => (
        <div key={row} className="card flex flex-col gap-3 p-4">
          <span className="h-3 w-24 rounded bg-surface-2" />
          <span className="h-3 w-full rounded bg-surface-2" />
          <span className="h-3 w-4/5 rounded bg-surface-2" />
        </div>
      ))}
    </aside>
  );
}

/** A remembered page is usable while it is in date *and* still current. */
function cacheIsUsable(cached, revision) {
  return Boolean(cached?.payload) && cached.fresh && cached.revision === revision;
}

/**
 * Locally held entries the authoritative page has not delivered yet.
 *
 * Anything the server did return is released (that copy is now canonical), and
 * anything older than the hold window is dropped, so a row the feed genuinely
 * excludes cannot linger on screen.
 */
function heldEntries(held, serverFeed = []) {
  const now = Date.now();
  const delivered = new Set((serverFeed || []).map((item) => String(item?.id ?? '')));
  const output = [];
  for (const [id, entry] of held) {
    if (delivered.has(id) || now - entry.at > HELD_POST_MS) held.delete(id);
    else output.push(entry.item);
  }
  return output;
}

export function HomeFeedClient({
  user,
  userId,
  currentUserId,
  canPost,
  canModerate,
  heroFeatures = null,
  afterFeed = null,
  quickLinks = [],
}) {
  const router = useRouter();
  // Only the stable members are pulled out: the provider's `status` changes when a
  // channel reconnects, and a feed surface must not re-run its whole load because of
  // that. `revision()` is a getter over the same live counter either way.
  const { subscribe: subscribeToFeed, revision: feedRevision, invalidate: invalidateFeed } = useLiveFeed();
  const [snapshot, setSnapshot] = useState(null);
  const [feedMode, setFeedMode] = useState('for-you');
  useEffect(() => {
    try {
      // Restore a non-sensitive per-tab preference after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (sessionStorage.getItem(`campus:feed-mode:${userId}`) === 'following') setFeedMode('following');
    } catch {}
  }, [userId]);
  const chooseFeed = (mode) => {
    setFeedMode(mode);
    try { sessionStorage.setItem(`campus:feed-mode:${userId}`, mode); } catch {}
  };
  // Essential readiness, not a mount/timer flag: the feed and its rail arrive
  // in one authoritative payload. It remains pending until that payload (or a
  // terminal error) settles; cached real content may render during revalidation.
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState(false);
  const requestRef = useRef(null);
  // Only the newest refresh may write. Forced signals can otherwise complete
  // out of order and put an older, less-authoritative snapshot back on screen.
  const requestVersionRef = useRef(0);
  // Rows this tab confirmed to the author that the authoritative page has not
  // returned yet. Held for a bounded moment so the post cannot flicker out of the
  // feed between the write and the re-read, then dropped so the server always wins.
  const [held] = useState(() => new Map());
  const liveTimerRef = useRef(null);
  // How many server feed rows this tab has actually received (offset + length of
  // the newest server page). The "Show more" cursor must follow server rows, not
  // the rendered window: a locally held post would otherwise inflate the offset
  // and skip an older post at the page boundary.
  const serverRowsRef = useRef(0);
  // Full poll snapshots, keyed by post id. They bridge optimistic voting and
  // the first authorized response that actually contains the committed vote.
  const pollOverlaysRef = useRef(new Map());
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (force = false) => {
    const cached = readHomeFeedCache(userId);
    // A page is served from memory only while nothing has changed to invalidate it
    // — a publish, a delete, a moderation action or a live event from another
    // student moves the shell's revision, which is what makes the difference
    // between "fast first paint" and "silently stale".
    if (!force && cacheIsUsable(cached, feedRevision())) {
      setSnapshot(cached.payload);
      setLoading(false);
      setError(false);
      return cached.payload;
    }

    if (cached?.payload) setSnapshot(cached.payload);
    else setLoading(true);

    // Coalesce ordinary refreshes. A forced refresh (e.g. after posting) waits
    // for any earlier request, then fetches again so it cannot miss the new row.
    if (requestRef.current) {
      if (!force) return requestRef.current;
      await requestRef.current.catch(() => {});
    }

    // Only canonical IDs for post cards are reconciled — never cached bodies,
    // rail data or the whole browser payload. GET remains the empty-cache path.
    const requestedPostIds = feedPostIds(
      readHomeFeedCache(userId)?.payload?.feed || [],
      HOME_FEED_RECONCILE_LIMIT,
    );
    const requestVersion = ++requestVersionRef.current;
    const task = (async () => {
      try {
        const response = await fetchEssentialFeed('/api/home/feed', {
          method: requestedPostIds.length ? 'POST' : 'GET',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            ...(requestedPostIds.length ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(requestedPostIds.length ? { body: JSON.stringify({ postIds: requestedPostIds }) } : {}),
        });

        if (requestVersion !== requestVersionRef.current) return null;
        if (response.status === 401) {
          clearHomeFeedCache(userId);
          setSnapshot(null);
          setError(true);
          router.replace('/login');
          return null;
        }
        if (response.status === 403) {
          clearHomeFeedCache(userId);
          setSnapshot(null);
          setError(true);
          router.refresh();
          return null;
        }
        if (!response.ok) throw new Error('Home feed request failed.');

        const payload = await response.json();
        if (requestVersion !== requestVersionRef.current) return null;
        if (!payload?.ok) throw new Error('Home feed response was invalid.');
        if (Array.isArray(payload.feed) && payload.page) {
          serverRowsRef.current = Math.max(
            serverRowsRef.current,
            Number(payload.page.offset) + payload.feed.length,
          );
        }

        if (payload.unavailable) {
          const previous = readHomeFeedCache(userId);
          setSnapshot(previous?.payload
            ? { ...previous.payload, feedUnavailable: true }
            : { ...payload, feedUnavailable: true });
          setError(true);
          return null;
        }

        // Page absence is not a deletion signal. Only IDs the visibility lookup
        // explicitly checked and did not return are removed, across the fresh head,
        // held writes and every older page. Unchecked/valid older rows stay loaded.
        const reconciliation = payload.reconciliation;
        const removedPostIds = reconciliation?.unavailable === false
          ? findRemovedFeedPostIds(
              requestedPostIds,
              reconciliation.checkedPostIds,
              reconciliation.visiblePostIds,
            )
          : [];
        for (const id of removedPostIds) held.delete(id);

        // Held entries still cover an accepted published write that is visible by
        // ID but has not reached this newest page yet. The next server copy dedupes it.
        const feedWindow = mergeFeedPages(
          reconcileFeed(payload.feed, heldEntries(held, payload.feed)),
          readHomeFeedCache(userId)?.payload?.feed || [],
          { removedPostIds },
        );
        const overlaid = reconcileFeedPollOverlays(
          feedWindow,
          pollOverlaysRef.current,
          feedPostIds(payload.feed),
        );
        for (const id of overlaid.settled) pollOverlaysRef.current.delete(id);
        // The rail is server-ranked. An unavailable/missing trending read is not
        // a quiet campus: keep the last honest rows instead of blanking the rail.
        const previousTrending = readHomeFeedCache(userId)?.payload?.trending || [];
        const trending = Array.isArray(payload.trending) && !payload.trendingUnavailable
          ? payload.trending
          : previousTrending;
        const next = writeHomeFeedCache(userId, { ...payload, trending, feed: overlaid.feed }, feedRevision());
        setSnapshot(next);
        setError(false);
        return next;
      } catch {
        if (requestVersion === requestVersionRef.current) {
          const previous = readHomeFeedCache(userId);
          if (previous?.payload) {
            setSnapshot(previous.payload);
            setError(false);
          } else {
            setError(true);
          }
        }
        return null;
      } finally {
        if (requestVersion === requestVersionRef.current) setLoading(false);
      }
    })();

    requestRef.current = task;
    try {
      return await task;
    } finally {
      if (requestRef.current === task) requestRef.current = null;
    }
  }, [feedRevision, held, router, userId]);

  /**
   * The author's own post, placed the moment the server confirms it.
   *
   * `createPost` returns the canonical hydrated row — database id, timestamp,
   * author block, counters, poll options, viewer state — so this is the same shape
   * the feed read produces, not a stub: `StreamItem` renders it with no further
   * work, and the re-read that follows reconciles it in place. A post that the
   * shared eligibility rule excludes (a community-scoped row, or one the database
   * did not publish) is never placed at all, and is reported by the composer
   * instead.
   */
  const applyCreatedPost = useCallback((result) => {
    const post = result?.post;
    if (!isCampusFeedEligible(post)) return;
    const item = postToFeedItem(post);
    if (!item) return;
    held.set(String(post.id), { item, at: Date.now() });

    const patch = (payload) => ({
      ...payload,
      // No window: placing a post must not push the oldest loaded entry off the page.
      feed: placePostInFeed(payload?.feed || [], post),
    });
    // Patch the remembered page too, so navigating away and back inside the cache
    // window shows the post instead of the feed as it was before the write.
    const stored = patchHomeFeedCache(userId, patch, feedRevision());
    if (stored) setSnapshot(stored);
    else setSnapshot((current) => (current ? patch(current) : current));

    // The authoritative page is then re-read once, through the same coalesced path a
    // live change uses: order, counters and the rail all come from the server, and
    // the canonical-id dedup means the reconcile cannot leave a second copy of the
    // row it just placed. Other surfaces mounted in this tab hear the same signal.
    invalidateFeed('local', [post.id]);
  }, [feedRevision, held, invalidateFeed, userId]);

  /**
   * Patch only the voted card and its remembered Home entry. The overlay also
   * wins over an older in-flight response until the authorized read contains
   * the committed vote, so voting needs no feed refresh or extra subscription.
   */
  const applyPollVote = useCallback(({ postId, optionId, poll, previousPoll, phase, mutation }) => {
    const id = String(postId || '');
    if (!id || !poll) return;
    const overlays = pollOverlaysRef.current;
    const current = overlays.get(id);
    if (current && current.mutation > mutation) return;

    let nextPoll = poll;
    if (phase === 'rollback') {
      nextPoll = current?.basePoll || previousPoll || poll;
      overlays.delete(id);
    } else {
      overlays.set(id, {
        optionId,
        poll,
        phase,
        mutation,
        basePoll: current?.basePoll || previousPoll || null,
      });
    }

    const patch = (payload) => ({
      ...payload,
      feed: patchFeedPoll(payload?.feed || [], id, nextPoll),
    });
    patchHomeFeedCache(userId, patch, feedRevision(), { notify: !mountedRef.current });
    // The card owns its visible optimistic/rollback state. Re-rendering the
    // entire Home snapshot here would make every unrelated card pay for a vote.
  }, [feedRevision, userId]);

  // Live changes: one subscription for the whole surface (never per card), and it
  // only ever triggers a re-read — the rows are hydrated by the shared read path.
  useEffect(() => {
    const unsubscribe = subscribeToFeed((event) => {
      const ids = (event?.postIds || []).map(String);
      // A removal is applied to the window straight away — a card that the database
      // says is gone must not sit there for another beat — and the row is released
      // from the hold set so nothing this tab placed locally can resurrect it.
      if (event?.reason === 'removed' && ids.length) {
        for (const id of ids) held.delete(id);
        const drop = (payload) => ids.reduce((items, id) => removePostFromFeed(items, id), payload?.feed || []);
        const stored = patchHomeFeedCache(userId, drop, feedRevision());
        if (stored) setSnapshot(stored);
        else setSnapshot((current) => (current ? { ...current, feed: drop(current) } : current));
      }
      if (liveTimerRef.current) return;
      liveTimerRef.current = setTimeout(() => {
        liveTimerRef.current = null;
        void refresh(true);
      }, LIVE_REFRESH_MS);
    });
    return () => {
      unsubscribe();
      if (liveTimerRef.current) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };
  }, [feedRevision, held, refresh, subscribeToFeed, userId]);

  useEffect(() => subscribeHomeFeedCache(userId, (payload) => {
    setSnapshot(payload);
    setLoading(false);
  }), [userId]);

  useEffect(() => {
    const cached = readHomeFeedCache(userId);
    if (cached?.payload) {
      // Synchronous cache hydration is intentional: it must happen before the
      // first paint of this already-mounted client, not after another render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnapshot(cached.payload);
      setLoading(false);
    } else {
      setSnapshot(null);
      setLoading(true);
    }
    void refresh(false);

    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible') return;
      // Both ways a page can be out of date: the window expired, or the shell moved
      // on while this surface was unmounted or hidden.
      if (!cacheIsUsable(readHomeFeedCache(userId), feedRevision())) void refresh(false);
    };
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', refreshIfStale);
    // Slow, visibility-gated convergence for engagement that happened in
    // another tab. `refresh(false)` still honours the cache/revision and the
    // in-flight coalescing, so this can never stack requests.
    const convergence = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refresh(false);
    }, TRENDING_REFRESH_MS);
    return () => {
      window.clearInterval(convergence);
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [feedRevision, refresh, userId]);

  useEffect(() => {
    const onFollow = (event) => {
      const { profileId, following } = event.detail || {};
      if (!profileId) return;
      const patch = (payload) => ({ ...payload, feed: (payload.feed || []).map((item) => item.post?.author_id === profileId
        ? { ...item, post: { ...item.post, following_by_me: following } } : item) });
      const updated = patchHomeFeedCache(userId, patch, feedRevision());
      if (updated) setSnapshot(updated);
      else setSnapshot((current) => current ? patch(current) : current);
    };
    window.addEventListener('campus:follow-change', onFollow);
    return () => window.removeEventListener('campus:follow-change', onFollow);
  }, [feedRevision, userId]);

  const feed = snapshot?.feed || [];
  const events = snapshot?.events || [];
  const notices = snapshot?.notices || [];
  const unavailable = Boolean(snapshot?.unavailable || snapshot?.feedUnavailable);
  // The rail is not derived from the loaded feed page any more. `/api/home/feed`
  // returns `trending` straight from the `trending_posts` RPC: already ranked by
  // recent engagement, with the database's score and counters on each row. No
  // client-side re-ranking, no duplicated or stale counter arithmetic.
  const trending = snapshot?.trending || [];
  const marketplace = feed.filter((item) => ['listing', 'deal'].includes(item.type)).slice(0, 3);
  // The stat is the total eligible posts on the feed (e.g. 14), not the number
  // currently loaded (10) — the server reports the total on every page.
  const feedTotal = typeof snapshot?.page?.total === 'number' ? snapshot.page.total : feed.length;
  const stats = snapshot
    ? [
        { label: 'Posts in feed', value: feedTotal },
        { label: 'Notices published', value: notices.length },
      ]
    : [];

  const canPageBack = Boolean(snapshot?.page?.hasMore) && feed.length > 0 && !unavailable;
  // Neither skeleton may outlive a terminal error. Cached content keeps its
  // real rail during revalidation; an empty-cache error gets only retry UI.
  const showInitialLoading = !snapshot && loading && !error;

  /**
   * One page older — another `HOME_FEED_PAGE_SIZE` entries — appended to what is on screen.
   *
   * A separate request rather than a bigger first page on purpose: Home's first paint
   * stays one screenful, and the cost of depth is paid only by the reader who asks for
   * it, one tap at a time. The rails keep coming from the newest page, and a failure leaves every
   * loaded entry on screen — falling back to page one would look like the reader's own
   * scrolling had reset the feed.
   */
  const loadMore = useCallback(async () => {
    if (!canPageBack || loadingMore) return;
    // Read the loaded pages off the snapshot rather than the render-local `feed`, so this
    // callback's identity follows the data instead of changing on every render.
    const loaded = snapshot?.feed || [];
    // Cursor over server rows, not over the rendered window: held/optimistic entries
    // must not push the offset past a row the server has not skipped yet, or an older
    // post would be missed at the page boundary.
    const cursor = Math.max(0, serverRowsRef.current);
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const response = await fetchEssentialFeed(`/api/home/feed?offset=${cursor}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Home feed page request failed.');
      const payload = await response.json();
      if (!payload?.ok || payload.unavailable) throw new Error('Home feed page response was invalid.');
      if (Array.isArray(payload.feed) && payload.page) {
        serverRowsRef.current = Math.max(
          serverRowsRef.current,
          Number(payload.page.offset) + payload.feed.length,
        );
      }
      const overlaid = reconcileFeedPollOverlays(
        mergeFeedPages(loaded, payload.feed),
        pollOverlaysRef.current,
        feedPostIds(payload.feed),
      );
      for (const id of overlaid.settled) pollOverlaysRef.current.delete(id);
      const next = {
        ...(snapshot || payload),
        feed: overlaid.feed,
        page: payload.page,
      };
      writeHomeFeedCache(userId, next, feedRevision());
      setSnapshot(next);
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [canPageBack, feedRevision, loadingMore, snapshot, userId]);

  return (
    <>
      <HomeInstallCard />

      <IslandMotion>
        <div className="home-body">
          <div className="home-body__main">
            <HomePulse user={user} stats={stats}>{heroFeatures}</HomePulse>
            <HomeZone id="home-stream-title" title="Campus feed" aside={feedMode === 'for-you' && feed.length ? (
              <span className="home-zone__count text-2xs text-muted">
                {typeof snapshot?.page?.total === 'number' && snapshot.page.total > feed.length
                  ? `${feed.length} of ${snapshot.page.total} entries`
                  : `${feed.length} ${feed.length === 1 ? 'entry' : 'entries'}`}
              </span>
            ) : null} />
            <HomeComposer
              canPost={canPost}
              authorName={user.profile.display_name || user.profile.username}
              authorUsername={user.profile.username}
              onCreated={applyCreatedPost}
            />

            <HomeFeedNavigation mode={feedMode} onChange={chooseFeed} />

            {feedMode === 'for-you' && unavailable ? (
              <div className="flex flex-col items-start gap-2">
                <Notice tone="warning" icon="flag">
                  The feed is temporarily unavailable. {feed.length ? 'Showing the last cached entries.' : 'Try again shortly.'}
                </Notice>
                {error ? <Button variant="secondary" size="sm" onClick={() => { void refresh(true); }}>Try again</Button> : null}
              </div>
            ) : null}

            {feedMode === 'for-you' ? <section
              className="flex flex-col gap-4"
              aria-labelledby="home-stream-title"
              aria-busy={!snapshot && loading}
            >
              {snapshot && feed.length === 0 && !unavailable ? (
                <EmptyState
                  icon="sparkle"
                  title="Nothing on the feed yet"
                  description={canPost
                    ? 'The feed is genuinely empty right now. The composer above is the fastest way to start it — a question counts.'
                    : 'The feed is genuinely empty right now. Official notices and events from campus are still worth a look.'}
                  action={
                    <Link href="/campus/events" className="text-xs font-semibold text-accent-ink hover:underline">
                      See what&apos;s on this week →
                    </Link>
                  }
                />
              ) : null}

              {showInitialLoading ? <FeedSkeleton /> : null}

              {feed.length ? (
                <div className="home-stream">
                  {feed.map((item, index) => {
                    const post = item.post || null;
                    return (
                      <StreamSlot key={`${item.type}-${item.id}`} kind={item.type} order={index}>
                        <StreamItem
                          item={item}
                          post={post}
                          currentUserId={currentUserId}
                          canModerate={canModerate}
                          onPollVote={applyPollVote}
                          reactions={{
                            count: post?.reaction_count || 0,
                            mine: Boolean(post?.reacted_by_me),
                          }}
                        />
                      </StreamSlot>
                    );
                  })}
                </div>
              ) : null}

              {!snapshot && error ? (
                <div className="flex flex-col items-start gap-2">
                  <Notice tone="warning" icon="flag">The campus feed could not be loaded.</Notice>
                  <Button variant="secondary" size="sm" onClick={() => { void refresh(true); }}>Try again</Button>
                </div>
              ) : null}

              {canPageBack || loadMoreError ? (
                <div className="flex flex-col items-start gap-2">
                  {loadMoreError ? (
                    <Notice tone="warning" icon="flag">
                      The older posts could not be loaded. Everything above is still what the database
                      returned, and nothing has been thrown away.
                    </Notice>
                  ) : null}
                  {canPageBack ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={loadingMore}
                      aria-label={`Show ${HOME_FEED_PAGE_SIZE} more entries`}
                      onClick={() => { void loadMore(); }}
                    >
                      {loadingMore ? 'Loading more…' : 'Show more'}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {feed.length ? (
                <Link href={ROUTES.explore} className="self-start text-xs font-semibold text-accent-ink hover:underline">
                  More on Explore →
                </Link>
              ) : null}
            </section> : <FollowingFeed currentUserId={currentUserId} canModerate={canModerate} />}

            {afterFeed}
          </div>

          {snapshot ? (
            <HomeRail events={events} notices={notices} trending={trending} marketplace={marketplace} quickLinks={quickLinks} />
          ) : showInitialLoading ? (
            <RailSkeleton />
          ) : null}
        </div>
      </IslandMotion>
    </>
  );
}
