/**
 * Client-safe poll state transitions.
 *
 * A vote is optimistic only in the browser. The database remains authoritative:
 * these helpers apply one complete poll snapshot (never an increment to an
 * already-patched snapshot), reconcile the server's counts, and restore the
 * last authoritative snapshot after a rejected write.
 */

export function pollVoteTotal(poll) {
  return (poll?.options || []).reduce((total, option) => total + Math.max(0, Number(option.vote_count) || 0), 0);
}

export function selectedPollOptionId(poll) {
  return (poll?.options || []).find((option) => option.mine)?.id || null;
}

/**
 * Return a new snapshot for one first-choice vote, or null when the vote is not
 * permitted by the already-rendered state. RLS remains the actual security
 * boundary; these checks only keep the optimistic UI honest.
 */
export function applyOptimisticPollVote(poll, optionId, now = Date.now()) {
  if (!poll || !optionId || selectedPollOptionId(poll)) return null;
  if (poll.closes_at && new Date(poll.closes_at).getTime() <= now) return null;
  const options = Array.isArray(poll.options) ? poll.options : [];
  if (!options.some((option) => option.id === optionId)) return null;

  return {
    ...poll,
    options: options.map((option) => ({
      ...option,
      vote_count: Math.max(0, Number(option.vote_count) || 0) + (option.id === optionId ? 1 : 0),
      mine: option.id === optionId,
    })),
  };
}

/** Merge the authoritative option rows without dropping the post's close time. */
export function reconcilePollVote(poll, authoritative) {
  if (!Array.isArray(authoritative?.options)) return poll;
  return {
    ...poll,
    ...authoritative,
    closes_at: authoritative.closes_at ?? poll?.closes_at ?? null,
    options: authoritative.options.map((option) => ({ ...option, mine: option.mine === true })),
  };
}

/** Replace exactly one post's poll in a mixed feed; unrelated cards keep identity. */
export function patchFeedPoll(feed, postId, poll) {
  if (!postId || !poll || !Array.isArray(feed)) return Array.isArray(feed) ? feed : [];
  let changed = false;
  const next = feed.map((item) => {
    const id = item?.post?.id || ((['post', 'discussion', 'poll'].includes(item?.type)) ? item?.id : null);
    if (String(id || '') !== String(postId) || !item.post) return item;
    changed = true;
    return { ...item, post: { ...item.post, poll } };
  });
  return changed ? next : feed;
}

/**
 * True only when a fresh server snapshot contains this vote and at least the
 * counts the client already rendered. That lets newer votes from other students
 * replace the overlay while an older in-flight response cannot roll it back.
 */
export function pollContainsVote(poll, optionId, expectedOptions = []) {
  if (!optionId || selectedPollOptionId(poll) !== optionId) return false;
  const actual = new Map((poll?.options || []).map((option) => [option.id, Number(option.vote_count) || 0]));
  return (expectedOptions || []).every((option) => (actual.get(option.id) || 0) >= (Number(option.vote_count) || 0));
}

/**
 * Fold local vote snapshots over a feed response.
 *
 * Only rows in `authoritativePostIds` came from the new response; an older
 * cached page may look identical to the overlay and must not settle it. The
 * latest authoritative base is remembered for rollback. A committed overlay is
 * released as soon as the server copy contains the vote and its counts.
 */
export function reconcileFeedPollOverlays(feed, overlays, authoritativePostIds = []) {
  if (!Array.isArray(feed) || !overlays?.size) return { feed, settled: [] };
  const authoritative = new Set((authoritativePostIds || []).map(String));
  const settled = [];
  const next = feed.map((item) => {
    const postId = String(item?.post?.id || item?.id || '');
    const overlay = overlays.get(postId);
    if (!overlay || !item.post) return item;

    if (authoritative.has(postId)) {
      overlay.basePoll = item.post.poll || overlay.basePoll;
      if (overlay.phase === 'committed' && pollContainsVote(item.post.poll, overlay.optionId, overlay.poll?.options)) {
        settled.push(postId);
        return item;
      }
    }
    return { ...item, post: { ...item.post, poll: overlay.poll } };
  });
  return { feed: next, settled };
}
