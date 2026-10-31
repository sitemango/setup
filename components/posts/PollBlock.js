'use client';

import { useEffect, useRef, useState } from 'react';
import { votePoll } from '@/lib/actions/social';
import { compactNumber, cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';
import { Badge } from '@/components/ui';
import {
  applyOptimisticPollVote,
  pollContainsVote,
  pollVoteTotal,
  reconcilePollVote,
  selectedPollOptionId,
} from '@/lib/social/poll-state';

/**
 * Poll rendering + voting. Counts are maintained by database triggers; the
 * optimistic snapshot makes the accepted interaction visible immediately and
 * is then replaced by the server's option rows. No router/feed refresh is used.
 */
export function PollBlock({ postId, poll, canVote = true, onVoteChange = null }) {
  const [override, setOverride] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const pendingRef = useRef(false);
  const mutationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const currentPoll = override || poll;
  const options = currentPoll?.options || [];
  const total = pollVoteTotal(currentPoll);
  const myOption = selectedPollOptionId(currentPoll);
  // Evaluated once, as before: the server remains the authority on every write,
  // so a stale open display can never make a late vote succeed.
  const [closed] = useState(() => Boolean(poll?.closes_at && new Date(poll.closes_at).getTime() <= Date.now()));
  const showResults = Boolean(myOption) || closed;

  // Once a parent has the same (or newer) authoritative vote, drop the local
  // override so later counts from other students can render normally. While a
  // request is pending, stale props never replace the optimistic snapshot.
  useEffect(() => {
    if (!pending && override && pollContainsVote(poll, selectedPollOptionId(override), override.options)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverride(null);
    }
  }, [override, pending, poll]);

  async function castVote(optionId) {
    // A ref closes the same-frame gap before React's disabled prop is painted.
    if (pendingRef.current || pending || !canVote || closed || myOption) return;
    const optimistic = applyOptimisticPollVote(currentPoll, optionId);
    if (!optimistic) return;

    const mutation = ++mutationRef.current;
    const previous = currentPoll;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    setStatus('Saving vote…');
    setOverride(optimistic);
    onVoteChange?.({ postId, optionId, poll: optimistic, previousPoll: previous, phase: 'optimistic', mutation });

    const data = new FormData();
    data.set('post_id', postId);
    data.set('option_id', optionId);

    let result;
    try {
      result = await votePoll(data);
    } catch (thrown) {
      result = { ok: false, error: thrown?.message || 'Your vote could not be saved. Please try again.' };
    }
    if (mutation !== mutationRef.current) return;

    if (!result?.ok) {
      pendingRef.current = false;
      onVoteChange?.({ postId, optionId, poll: previous, phase: 'rollback', mutation });
      if (mountedRef.current) {
        setOverride(null);
        setPending(false);
        setStatus(null);
        setError(result?.error || 'Your vote could not be saved. Please try again.');
      }
      return;
    }

    // An insert can succeed even if a fronted PostgREST drops the follow-up
    // representation. In that case the optimistic snapshot remains until a
    // later authorized read; a committed vote is never reported as rolled back.
    const authoritative = result.poll ? reconcilePollVote(previous, result.poll) : optimistic;
    pendingRef.current = false;
    onVoteChange?.({ postId, optionId, poll: authoritative, phase: 'committed', mutation });
    if (mountedRef.current) {
      setOverride(authoritative);
      setPending(false);
      setStatus(result.reconciled === false ? 'Vote saved. Results will be confirmed on the next feed update.' : 'Vote saved.');
    }
  }

  return (
    <div className="card-flush mt-3 p-3" aria-busy={pending}>
      <ul className="flex flex-col gap-2">
        {options.map((option) => {
          const count = Math.max(0, Number(option.vote_count) || 0);
          const share = total ? Math.round((count / total) * 100) : 0;
          const mine = myOption === option.id;
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={!canVote || Boolean(myOption) || closed || pending || !option.id}
                onClick={() => { void castVote(option.id); }}
                className={cn(
                  'cp-poll-option group w-full overflow-hidden rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-all',
                  mine ? 'cp-poll-option--selected' : null,
                  !canVote || myOption || closed ? 'cursor-default' : 'cursor-pointer active:scale-[0.995]',
                )}
                aria-pressed={mine}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-[0.8125rem] font-medium">{option.label}</span>
                    {mine ? <Icon name="check" size={13} className="shrink-0 text-accent" /> : null}
                  </span>
                  {showResults ? (
                    <span className="shrink-0 text-2xs font-semibold text-muted t-numeric">
                      {compactNumber(count)} · {share}%
                    </span>
                  ) : null}
                </span>
                {showResults ? (
                  <span className="cp-poll-track mt-2 block h-1.5 w-full overflow-hidden rounded-full">
                    <span
                      className={cn('cp-poll-fill block h-full rounded-full transition-[width] duration-500', mine ? 'cp-poll-fill--selected' : null)}
                      style={{ width: `${share}%` }}
                    />
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
        <span className="t-numeric">
          {compactNumber(total)} vote{total === 1 ? '' : 's'}
        </span>
        <span aria-hidden="true">·</span>
        {closed ? <Badge tone="warning">Poll closed</Badge> : <span>One vote per student</span>}
      </p>
      {status ? <p className="sr-only" role="status">{status}</p> : null}
      {error ? <p className="mt-1 text-2xs text-danger" role="alert">{error}</p> : null}
    </div>
  );
}
