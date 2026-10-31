import { afterEach, describe, expect, it } from 'vitest';
import {
  applyOptimisticPollVote,
  patchFeedPoll,
  pollContainsVote,
  pollVoteTotal,
  reconcileFeedPollOverlays,
  reconcilePollVote,
  selectedPollOptionId,
} from '@/lib/social/poll-state';
import {
  clearHomeFeedCache,
  patchHomeFeedCache,
  readHomeFeedCache,
  subscribeHomeFeedCache,
  writeHomeFeedCache,
} from '@/components/home/homeFeedCache';

const poll = () => ({
  closes_at: null,
  options: [
    { id: 'a', post_id: 'poll-1', label: 'A', position: 1, vote_count: 2, mine: false },
    { id: 'b', post_id: 'poll-1', label: 'B', position: 2, vote_count: 1, mine: false },
  ],
});
const item = (postId = 'poll-1', value = poll()) => ({
  id: postId,
  type: 'poll',
  sortAt: '2026-10-31T10:00:00.000Z',
  post: { id: postId, kind: 'poll', poll: value },
});

afterEach(() => clearHomeFeedCache('poll-cache-test'));

describe('poll voting regression scenarios', () => {
  it('1. immediately selects one answer and updates counts, percentages and total', () => {
    const next = applyOptimisticPollVote(poll(), 'a', 100);
    expect(selectedPollOptionId(next)).toBe('a');
    expect(next.options.map((option) => option.vote_count)).toEqual([3, 1]);
    expect(pollVoteTotal(next)).toBe(4);
    expect(next.options.map((option) => Math.round((option.vote_count / pollVoteTotal(next)) * 100))).toEqual([75, 25]);
  });

  it('2. rejects an unknown option without mutating the rendered poll', () => {
    const previous = poll();
    const snapshot = structuredClone(previous);
    expect(applyOptimisticPollVote(previous, 'not-in-this-poll', 100)).toBeNull();
    expect(previous).toEqual(snapshot);
  });

  it('3. preserves the one-vote answer rule instead of adding a second answer', () => {
    const voted = applyOptimisticPollVote(poll(), 'a', 100);
    expect(applyOptimisticPollVote(voted, 'b', 100)).toBeNull();
    expect(pollVoteTotal(voted)).toBe(4);
    expect(voted.options.filter((option) => option.mine)).toHaveLength(1);
  });

  it('4. replaces optimistic counts with authoritative trigger-maintained counts', () => {
    const previous = poll();
    const optimistic = applyOptimisticPollVote(previous, 'a', 100);
    const authoritative = {
      options: [
        { ...previous.options[0], vote_count: 5, mine: true },
        { ...previous.options[1], vote_count: 4, mine: false },
      ],
    };
    const reconciled = reconcilePollVote(previous, authoritative);
    expect(reconciled.options.map((option) => option.vote_count)).toEqual([5, 4]);
    expect(pollVoteTotal(reconciled)).toBe(9);
    expect(selectedPollOptionId(reconciled)).toBe('a');
    expect(pollContainsVote(reconciled, 'a', optimistic.options)).toBe(true);
    expect(optimistic.options.map((option) => option.vote_count)).toEqual([3, 1]);
  });

  it('5. restores the last authoritative snapshot after a rejected write', () => {
    const previous = poll();
    const optimistic = applyOptimisticPollVote(previous, 'b', 100);
    const overlays = new Map([['poll-1', { optionId: 'b', poll: optimistic, basePoll: previous, phase: 'optimistic' }]]);
    const pending = reconcileFeedPollOverlays([item()], overlays, ['poll-1']);
    expect(pollVoteTotal(pending.feed[0].post.poll)).toBe(4);
    const rolledBack = patchFeedPoll(pending.feed, 'poll-1', overlays.get('poll-1').basePoll);
    expect(rolledBack[0].post.poll).toEqual(previous);
    expect(pollVoteTotal(rolledBack[0].post.poll)).toBe(3);
  });

  it('6. patches only the voted card, leaving an independent poll untouched', () => {
    const other = item('poll-2');
    const target = item('poll-1');
    const next = patchFeedPoll([target, other], 'poll-1', applyOptimisticPollVote(poll(), 'a', 100));
    expect(next[0]).not.toBe(target);
    expect(next[1]).toBe(other);
    expect(selectedPollOptionId(next[0].post.poll)).toBe('a');
    expect(selectedPollOptionId(next[1].post.poll)).toBeNull();
  });

  it('7. synchronizes the bounded Home cache and notifies a navigation-return listener', () => {
    const optimistic = applyOptimisticPollVote(poll(), 'a', 100);
    writeHomeFeedCache('poll-cache-test', { feed: [item()], events: [], notices: [] }, 4);
    const deliveries = [];
    const unsubscribe = subscribeHomeFeedCache('poll-cache-test', (payload) => deliveries.push(payload));
    patchHomeFeedCache('poll-cache-test', (payload) => ({
      ...payload,
      feed: patchFeedPoll(payload.feed, 'poll-1', optimistic),
    }), 4);
    const remembered = readHomeFeedCache('poll-cache-test');
    expect(remembered.revision).toBe(4);
    expect(selectedPollOptionId(remembered.payload.feed[0].post.poll)).toBe('a');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toBe(remembered.payload);
    unsubscribe();
  });

  it('8. does not let a stale hydration response overwrite a pending or committed vote', () => {
    const optimistic = applyOptimisticPollVote(poll(), 'a', 100);
    const overlays = new Map([['poll-1', { optionId: 'a', poll: optimistic, basePoll: poll(), phase: 'committed' }]]);
    const stale = reconcileFeedPollOverlays([item()], overlays, ['poll-1']);
    expect(stale.settled).toEqual([]);
    expect(stale.feed[0].post.poll.options[0].vote_count).toBe(3);

    const freshPoll = poll();
    freshPoll.options[0] = { ...freshPoll.options[0], vote_count: 4, mine: true };
    const fresh = reconcileFeedPollOverlays([item('poll-1', freshPoll)], overlays, ['poll-1']);
    expect(fresh.settled).toEqual(['poll-1']);
    expect(fresh.feed[0].post.poll.options[0].vote_count).toBe(4);
  });

  it('9. applies the same overlay repeatedly without a Realtime/refetch double-count', () => {
    const optimistic = applyOptimisticPollVote(poll(), 'a', 100);
    const overlays = new Map([['poll-1', { optionId: 'a', poll: optimistic, basePoll: poll(), phase: 'committed' }]]);
    const once = reconcileFeedPollOverlays([item()], overlays, []);
    const twice = reconcileFeedPollOverlays(once.feed, overlays, []);
    expect(twice.feed[0].post.poll.options.map((option) => option.vote_count)).toEqual([3, 1]);
    expect(pollVoteTotal(twice.feed[0].post.poll)).toBe(4);
  });

  it('10. refuses optimistic voting after the close time; the server remains authoritative', () => {
    const expired = { ...poll(), closes_at: new Date(99).toISOString() };
    expect(applyOptimisticPollVote(expired, 'a', 100)).toBeNull();
    expect(pollVoteTotal(expired)).toBe(3);
    expect(selectedPollOptionId(expired)).toBeNull();
  });
});
