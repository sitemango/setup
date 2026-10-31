import { ROUTES } from '@/lib/constants';
import { ContentCard } from '@/components/content/ContentCard';
import { PostCard } from '@/components/posts/PostCard';
import { formatCalendarBadge, formatDate, formatTime } from '@/lib/utils';

/**
 * One entry in the Home stream.
 *
 * The stream is a single column of the unified campus feed, so every entry is
 * the *same* component family (PostCard / ContentCard) with the `stream` skin —
 * what changes is the composition around the content and the stamp on the
 * right, because an event, a notice and a listing are read differently:
 *
 *   event         a date plate, then where and when
 *   notice        the headline is the picture; the category leads, the date
 *                 trails in mono
 *   listing       price first — "Free" or the amount — with condition and seller
 *   opportunity   the deadline, and who is offering it
 *   post et al.   the post card: author, title, body, reactions, comments
 *
 * Nothing here invents content: every stamp is built from the fields the
 * `campus_feed()` row already carries, and a missing field simply removes its
 * line rather than filling it with a placeholder.
 */

/** Which wrapper the entry gets, so the CSS can vary marker and type scale. */
function kindOf(type) {
  if (type === 'deal') return 'listing';
  return type;
}

function EventStamp({ meta }) {
  if (!meta?.starts_on) return null;
  const badge = formatCalendarBadge(meta.starts_on);
  return (
    <span className="stream-stamp">
      <span className="stream-stamp__label">{badge.month}</span>
      <span className="stream-stamp__value">{badge.day}</span>
    </span>
  );
}

function ListingStamp({ meta }) {
  if (!meta) return null;
  const free = meta.is_free === true;
  const price = meta.price != null ? `₹${meta.price}` : null;
  if (!free && !price) return null;
  return (
    <span className="stream-stamp stream-stamp--price">
      <span className="stream-stamp__label">{free ? 'free' : 'price'}</span>
      <span className="stream-stamp__value">{free ? '₹0' : price}</span>
    </span>
  );
}

function NoticeMeta({ item }) {
  const { category, importance } = item.meta || {};
  return (
    <span className="stream-card__meta">
      {category ? <span className="uppercase tracking-[0.14em]">{category}</span> : null}
      {importance === 'critical' || importance === 'high' ? (
        <span className="font-semibold text-danger-strong">{importance === 'critical' ? 'Critical' : 'Important'}</span>
      ) : null}
      {item.createdAt ? <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time> : null}
    </span>
  );
}

export function StreamItem({ item, post, currentUserId, canModerate, onPollVote = null, reactions = { count: 0, mine: false } }) {
  const kind = kindOf(item.type);

  if (kind === 'event') {
    const meta = item.meta || {};
    return (
      <ContentCard
        variant="stream"
        href={ROUTES.event(item.id)}
        icon="calendar"
        title={item.title}
        description={item.body}
        official={item.isOfficial}
        emphasis={<EventStamp meta={meta} />}
        meta={[
          meta.start_time ? formatTime(meta.start_time) : null,
          meta.location || null,
          meta.organizer || null,
        ]}
        badges={[{ label: 'event' }]}
      />
    );
  }

  if (kind === 'notice') {
    return (
      <ContentCard
        variant="stream"
        href={ROUTES.notice(item.id)}
        title={item.title}
        description={item.body}
        official={item.isOfficial}
        footer={<NoticeMeta item={item} />}
      />
    );
  }

  if (kind === 'listing') {
    const meta = item.meta || {};
    return (
      <ContentCard
        variant="stream"
        href={ROUTES.listing(item.id)}
        icon="tag"
        title={item.title}
        description={item.body}
        emphasis={<ListingStamp meta={meta} />}
        meta={[
          item.authorUsername ? `@${item.authorUsername}` : null,
          meta.condition || null,
        ]}
        badges={[{ label: 'marketplace' }]}
      />
    );
  }

  if (kind === 'opportunity') {
    const meta = item.meta || {};
    return (
      <ContentCard
        variant="stream"
        href={ROUTES.opportunity(item.id)}
        icon="briefcase"
        title={item.title}
        description={item.body}
        official={item.isOfficial}
        meta={[meta.organization || null, meta.deadline ? `Closes ${formatDate(meta.deadline)}` : null]}
        badges={[{ label: 'opportunity' }]}
      />
    );
  }

  // Campus modules that the feed also carries (resources, projects, deals) are
  // listed with the same entry surface and their own destination.
  if (!['post', 'discussion', 'poll'].includes(item.type)) {
    const destination =
      kind === 'resource'
        ? ROUTES.resource(item.id)
        : kind === 'project'
          ? ROUTES.project(item.id)
          : ROUTES.campus;
    return (
      <ContentCard
        variant="stream"
        href={destination}
        icon="book"
        title={item.title}
        description={item.body}
        official={item.isOfficial}
        badges={[{ label: item.type }]}
      />
    );
  }

  if (!post) return null;

  return (
    <PostCard
      variant="stream"
      post={post}
      currentUserId={currentUserId}
      canModerate={canModerate}
      reactions={reactions}
      poll={post.poll}
      onPollVote={onPollVote}
    />
  );
}

/** The wrapper that gives each entry its kind — the marker colour and the type
 * scale are derived from it in CSS, so the components stay presentation-free. */
export function StreamSlot({ kind, children }) {
  return (
    <div className="stream-slot" data-kind={kindOf(kind)}>
      {children}
    </div>
  );
}
