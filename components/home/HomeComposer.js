'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PostComposer } from '@/components/posts/PostComposer';
import { Notice } from '@/components/ui';

/** The sidebar's Create shortcuts open the same composer used on Home. */
export function HomeComposer({ canPost = true, authorName, authorUsername, onCreated }) {
  const [requestedKind, setRequestedKind] = useState(null);
  const root = useRef(null);
  const params = useSearchParams();
  const compose = params.get('compose');
  useEffect(() => {
    if (!canPost || !['post', 'poll', 'discussion'].includes(compose)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRequestedKind({ kind: compose });
    const timer = window.setTimeout(() => {
      root.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      root.current?.querySelector(compose === 'post' ? '#post-body' : '#post-title')?.focus({ preventScroll: true });
      // Clear the one-shot intent so selecting the same action again still works.
      const url = new URL(window.location.href);
      url.searchParams.delete('compose');
      window.history.replaceState(window.history.state, '', url);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [compose, canPost]);
  return (
    <div className="home-composer" ref={root}>
      <p className="home-composer__label">New on campus <span aria-hidden="true">·</span> <span className="text-muted-soft">Posts, discussions and polls</span></p>
      {!canPost ? <Notice tone="neutral" icon="lock">Your account cannot publish posts right now.</Notice> : (
        <PostComposer authorName={authorName} authorUsername={authorUsername} onCreated={onCreated} defaultKind={requestedKind?.kind || 'post'} requestedKind={requestedKind} />
      )}
    </div>
  );
}
