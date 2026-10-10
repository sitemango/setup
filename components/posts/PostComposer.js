'use client';

import { useRef, useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { createPost } from '@/lib/actions/social';
import { LIMITS } from '@/lib/constants';
import { Button, Field, IdentityMark, Input, Notice, Textarea } from '@/components/ui';
import { GifPicker } from '@/components/media/GifPicker';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

const KINDS = [
  { value: 'post', label: 'Post', icon: 'sparkle', hint: 'A thought, a notice, a link' },
  { value: 'discussion', label: 'Discussion', icon: 'comment', hint: 'A question with a title' },
  { value: 'poll', label: 'Poll', icon: 'trend', hint: 'Let campus decide' },
];

/**
 * The one text composer.
 *
 * Text, an optional GIF, @mentions and — for discussions and polls — a title.
 * No file picker, no image upload, no attachment surface: those features do not
 * exist on Campus+ and the UI does not pretend otherwise.
 *
 * The surface opens with the question the product exists to ask: "What's
 * happening on campus?".
 */
export function PostComposer({ communityId = null, defaultKind = 'post', compact = false, authorName = null }) {
  const [kind, setKind] = useState(defaultKind);
  const [gif, setGif] = useState(null);
  const [options, setOptions] = useState(['', '']);
  const [body, setBody] = useState('');
  const [focused, setFocused] = useState(false);
  const formRef = useRef(null);

  const { run, pending, error, fieldErrors } = useFormAction(createPost, {
    onSuccess: () => {
      setBody('');
      setGif(null);
      setOptions(['', '']);
      setKind(defaultKind);
      formRef.current?.reset();
    },
  });

  const isPoll = kind === 'poll';
  const needsTitle = kind !== 'post';
  const canSubmit = !pending && (!isPoll || options.filter(Boolean).length >= 2);

  return (
    <form
      ref={formRef}
      action={run}
      className={cn(
        // Level-3 featured glass: the one surface on the feed allowed to glow.
        'glass-featured rounded-[var(--radius-lg)] overflow-hidden transition-shadow',
        focused ? 'shadow-[var(--shadow-raised)]' : null,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set('kind', kind);
        if (gif) data.set('gif', JSON.stringify(gif));
        if (communityId) {
          data.set('community_id', communityId);
          data.set('visibility', 'community');
        } else {
          data.set('visibility', 'campus');
        }
        run(data);
      }}
    >
      {!compact ? (
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
          <span className="hidden items-center gap-1.5 text-2xs font-semibold text-muted sm:flex">
            <Icon name="plus" size={12} />
            New
          </span>
          <div className="flex flex-1 flex-wrap items-center gap-1" role="tablist" aria-label="Post type">
            {KINDS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={kind === item.value}
                title={item.hint}
                onClick={() => setKind(item.value)}
                className="chip chip-plain"
              >
                <Icon name={item.icon} size={12} />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="p-4">
        <div className="flex gap-3">
          <IdentityMark name={authorName || 'You'} size={36} tone="accent" square={false} className="mt-0.5 hidden sm:flex" />
          <div className="min-w-0 flex-1">
            {!compact && kind === 'post' ? (
              <p className="mb-1 text-[0.9375rem] font-semibold tracking-[-0.015em] text-ink">What&apos;s happening on campus?</p>
            ) : null}

            {needsTitle ? (
              <Field
                label={isPoll ? 'Poll question' : 'Discussion title'}
                htmlFor="post-title"
                required
                error={fieldErrors?.title}
                className="mb-3"
              >
                <Input
                  id="post-title"
                  name="title"
                  maxLength={140}
                  required
                  placeholder={isPoll ? 'What should we decide?' : 'What should the discussion cover?'}
                />
              </Field>
            ) : null}

            <Field
              label={!compact ? (isPoll ? 'Context (optional)' : null) : kind === 'discussion' ? 'Your opening post' : 'Say something'}
              htmlFor="post-body"
              error={fieldErrors?.body}
              hint={isPoll ? undefined : `${body.length}/${LIMITS.post.max}`}
            >
              <Textarea
                id="post-body"
                name="body"
                rows={compact ? 3 : 3}
                maxLength={LIMITS.post.max}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                required={!isPoll}
                className={cn(!needsTitle && !compact ? 'cp-composer-input' : null)}
                placeholder={
                  compact
                    ? 'Write a reply…'
                    : 'Share something with campus. Use @username to mention someone.'
                }
              />
            </Field>

            {isPoll ? (
              <fieldset className="mt-3">
                <legend className="field-label">Options</legend>
                <div className="mt-2 flex flex-col gap-2">
                  {options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-center text-2xs font-semibold text-muted-soft">{index + 1}</span>
                      <Input
                        name="poll_options"
                        value={option}
                        maxLength={80}
                        aria-label={`Option ${index + 1}`}
                        placeholder={`Option ${index + 1}`}
                        onChange={(event) => {
                          const next = [...options];
                          next[index] = event.target.value;
                          setOptions(next);
                        }}
                      />
                      {options.length > 2 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="close"
                          aria-label={`Remove option ${index + 1}`}
                          onClick={() => setOptions(options.filter((_, i) => i !== index))}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
                {options.length < 6 ? (
                  <Button variant="ghost" size="sm" icon="plus" className="mt-2" onClick={() => setOptions([...options, ''])}>
                    Add option
                  </Button>
                ) : null}
              </fieldset>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <GifPicker value={gif} onPick={setGif} onRemove={() => setGif(null)} />
              </div>
              <Button type="submit" tone="accent" size="lg" icon="send" loading={pending} disabled={!canSubmit}>
                {pending ? 'Posting…' : isPoll ? 'Publish poll' : kind === 'discussion' ? 'Start discussion' : 'Post'}
              </Button>
            </div>
          </div>
        </div>

        {error ? (
          <Notice tone="danger" className="mt-3" icon="flag">
            {error}
          </Notice>
        ) : null}
      </div>
    </form>
  );
}
