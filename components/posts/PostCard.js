import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { cn, relativeTime, truncate } from '@/lib/utils';
import { Badge, OfficialBadge } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { GifAttachment } from '@/components/media/GifPicker';
import { ReactionBar } from '@/components/posts/ReactionBar';
import { PostActions } from '@/components/posts/PostActions';
import { PollBlock } from '@/components/posts/PollBlock';
import { ReportDialog } from '@/components/social/ReportDialog';
import { renderTextWithMentions } from '@/components/posts/richText';
import { segmentTextLinks } from '@/lib/linkify';
import { LinkifiedText } from '@/components/content/LinkifiedText';

/** Feed truncation that never cuts through a URL. */
function truncateFeedBody(text) {
  const source = String(text ?? '');
  if (source.length <= 420) return source;
  let offset = 0;
  for (const segment of segmentTextLinks(source)) {
    if (segment.type === 'link' && offset < 420 && offset + segment.value.length > 420) {
      return `${source.slice(0, offset).trimEnd()}…`;
    }
    offset += segment.value.length;
  }
  return truncate(source, 420);
}

/**
 * The one post card — posts, discussions and polls.
 *
 * Reading order is deliberate: who → what → what can I do. No view counts, no
 * engagement theatre, no presence: username, text, timestamp, reactions,
 * comments, report. Official content is labelled; student content never claims
 * to be official.
 *
 * The card is quiet on purpose: a hairline edge, a soft shadow, and hierarchy
 * carried by type rather than by decoration.
 */
export function PostCard({
  post,
  currentUserId = null,
  canModerate = false,
  reactions = { count: 0, mine: false },
  poll = null,
  onPollVote = null,
  showCommunity = true,
  detail = false,
  variant = 'card',
}) {
  // `card` is the default everywhere; `stream` is the Home feed's entry
  // presentation — the same content, the same actions, a surface and a type
  // scale tuned for reading a column of posts (see app/styles/home.css).
  const stream = variant === 'stream';
  const isOwner = currentUserId && post.author_id === currentUserId;
  const isDeleted = post.status === 'deleted';
  const isHidden = post.status === 'hidden' || post.status === 'removed';
  // Truncate for the feed without slicing a URL in half (see ContentCard):
  // if the cut lands inside a link, end the preview just before it.
  const body = detail ? post.body : truncateFeedBody(post.body);

  const commentCount = post.comment_count ?? 0;
  const kindLabel = post.kind === 'discussion' ? 'Discussion' : post.kind === 'poll' ? 'Poll' : null;

  return (
    <article
      className={cn(
        stream ? 'stream-card stream-card--post' : 'card p-4',
        post.is_official && !stream ? 'card-official' : null,
        post.is_official && stream ? 'stream-card--official' : null,
      )}
      data-kind={post.kind}
      aria-label={kindLabel || 'Post'}
    >
      <div className="flex items-start justify-between gap-3">
        <IdentityLine
          username={post.author_username}
          displayName={post.author_display_name}
          isStaff={post.author_is_staff}
          timestamp={post.created_at}
        />
        <div className="flex shrink-0 items-center gap-1.5">
          {post.is_official ? <OfficialBadge /> : null}
          {kindLabel ? (
            <Badge icon={post.kind === 'poll' ? 'trend' : 'comment'}>{kindLabel}</Badge>
          ) : null}
          {isHidden ? <Badge tone="danger">{post.status}</Badge> : null}
          {!isOwner ? <ReportDialog targetType="post" targetRef={post.id} label="this post" /> : null}
          {canModerate ? (
            <Link
              href={`/moderator?target=post&id=${post.id}`}
              className="rounded-full border border-line px-2 py-0.5 text-2xs font-semibold text-muted transition-colors hover:border-line-strong hover:text-ink hover:no-underline"
            >
              Moderate
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        {post.kind !== 'post' && post.title ? (
          <h2 className={stream ? 'stream-card__title' : 't-card leading-snug'}>
            {detail ? <LinkifiedText text={post.title} /> : <Link href={ROUTES.post(post.id)}>{post.title}</Link>}
          </h2>
        ) : null}

        {isDeleted ? (
          <p className="mt-1 text-[0.8125rem] italic text-muted">
            {isOwner
              ? 'You deleted this post. It stays hidden from everyone else — restore it to bring it back.'
              : 'This post was deleted by its author.'}
          </p>
        ) : (
          <p className={cn('user-text', stream ? 'stream-card__body' : 't-body mt-1')}>
            {detail ? renderTextWithMentions(post.body) : renderTextWithMentions(body)}
            {!detail && post.body?.length > 420 ? (
              <>
                {' '}
                <Link href={ROUTES.post(post.id)} className="font-medium text-accent-ink underline">
                  Read more
                </Link>
              </>
            ) : null}
          </p>
        )}

        {post.gif?.url && !isDeleted ? (
          <div className="mt-3">
            <GifAttachment gif={post.gif} />
          </div>
        ) : null}

        {poll && !isDeleted ? (
          <PollBlock postId={post.id} poll={poll} canVote={Boolean(currentUserId)} onVoteChange={onPollVote} />
        ) : null}

        {showCommunity && post.community_slug ? (
          <p className="mt-2.5 text-2xs text-muted">
            in{' '}
            <Link href={ROUTES.community(post.community_slug)} className="font-semibold text-ink-soft underline">
              {post.community_name || `c/${post.community_slug}`}
            </Link>
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          'mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3',
          stream ? 'stream-card__footer' : null,
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ReactionBar
            targetType="post"
            targetId={post.id}
            count={reactions.count}
            reactedByMe={reactions.mine}
            canReact={Boolean(currentUserId) && !isDeleted}
          />
          <Link
            href={ROUTES.post(post.id)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-2xs font-semibold text-muted transition-colors hover:border-line-strong hover:text-ink hover:no-underline"
          >
            <Icon name="comment" size={13} />
            {commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : 'Comment'}
          </Link>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-2xs text-muted-soft lg:hidden">{relativeTime(post.created_at)}</span>
          <PostActions postId={post.id} status={post.status} canManage={isOwner} />
        </div>
      </div>
    </article>
  );
}
