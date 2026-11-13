import Link from 'next/link';
import { ROUTES, TRENDING_FULL_SCALE } from '@/lib/constants';
import { RailCard, Badge } from '@/components/ui';
import { formatCalendarBadge, formatDate, formatTime } from '@/lib/utils';
import { activityBarPercentages } from '@/lib/social/activity-scale';

/**
 * The contextual column: five small destinations, five different treatments.
 *
 * This is the part of Home that most easily becomes a column of identical
 * cards, so each module is composed for how it is actually read:
 *
 *   events      a timeline — next one lit, dates as small plates
 *   notices     editorial — category leads, headline is the picture
 *   busiest     activity — quiet bars drawn from the real trending score
 *   marketplace price first, the way a listing is read
 *   shortcuts   a keypad of modules, not a list of links
 *
 * Every value is real and every link goes where it says; a module with nothing
 * in it is not rendered at all.
 */
export function HomeRail({ events = [], notices = [], trending = [], marketplace = [] }) {
  // The rows arrive already ranked by the database's recent-engagement score.
  // Bars are normalized against an absolute, configurable benchmark in one
  // shared helper (lib/social/activity-scale.js) — never against the highest
  // counter on screen, which is what made two likes look like a full bar.
  const percentages = activityBarPercentages(
    trending.map((post) => post?.score),
    TRENDING_FULL_SCALE,
  );

  return (
    <aside className="home-body__rail" aria-label="Campus information">
      {notices.length ? (
        <RailCard
          variant="island"
          elevation={1}
          tone="teal"
          className="rail-island rail-island--notices"
          icon="megaphone"
          title="Noticeboard"
          action={
            <Link href="/campus/noticeboard" className="text-2xs font-semibold text-muted hover:text-ink">
              View all
            </Link>
          }
        >
          <div className="rail-notice">
            {notices.map((notice) => (
              <Link
                key={notice.id}
                href={ROUTES.notice(notice.id)}
                className="rail-notice__item hover:no-underline"
                data-importance={notice.importance}
              >
                <span className="rail-notice__label">
                  <span className="rail-notice__dot" aria-hidden="true" />
                  {notice.category || (notice.importance === 'critical' ? 'Critical' : 'Notice')}
                </span>
                <span className="rail-notice__headline">{notice.title}</span>
                {notice.published_at ? (
                  <time className="rail-notice__date" dateTime={notice.published_at}>
                    {formatDate(notice.published_at)}
                  </time>
                ) : null}
              </Link>
            ))}
          </div>
        </RailCard>
      ) : null}

      {trending.length ? (
        <RailCard
          variant="island"
          elevation={1}
          tone="teal"
          className="rail-island rail-island--activity"
          icon="trend"
          title="Busiest right now"
        >
          <ol className="rail-activity">
            {trending.map((post, index) => {
              const percentage = percentages[index] ?? 0;
              return (
                <li key={post.id}>
                  <div className="rail-activity__row">
                    <span className="rail-activity__rank">{String(index + 1).padStart(2, '0')}</span>
                    <Link href={ROUTES.post(post.id)} className="rail-activity__text hover:no-underline">
                      {post.title || post.body?.slice(0, 90) || 'Post'}
                    </Link>
                    {/* The counters, in the words the rest of the product uses. */}
                    <span className="rail-activity__meter">
                      <span className="rail-activity__count" title="reactions">
                        {post.reaction_count || 0}
                        <span aria-hidden="true"> ♥</span>
                      </span>
                      <span className="rail-activity__count" title="comments">
                        {post.comment_count || 0}
                        <span aria-hidden="true"> ↺</span>
                      </span>
                    </span>
                  </div>
                  <span
                    className="rail-activity__bar"
                    aria-hidden="true"
                    data-hot={percentage >= 100 ? 'true' : undefined}
                  >
                    <span style={{ width: `${percentage}%` }} />
                  </span>
                </li>
              );
            })}
          </ol>
        </RailCard>
      ) : null}

      {events.length ? (
        <RailCard
          variant="island"
          elevation={2}
          tone="warm"
          className="rail-island rail-island--events"
          icon="calendar"
          title="Next on campus"
          action={
            <Link href="/campus/events" className="text-2xs font-semibold text-muted hover:text-ink">
              All
            </Link>
          }
        >
          <ol className="rail-timeline">
            {events.map((event, index) => {
              const badge = formatCalendarBadge(event.starts_on);
              return (
                <li className="rail-event" key={event.id} data-next={index === 0 ? 'true' : undefined}>
                  <span className="rail-event__day">
                    <span className="rail-event__month">{badge.month}</span>
                    <span className="rail-event__num">{badge.day}</span>
                  </span>
                  <span className="rail-event__body">
                    <Link href={ROUTES.event(event.id)} className="hover:no-underline">
                      <span className="rail-event__title">{event.title}</span>
                    </Link>
                    <span className="rail-event__meta">
                      {formatTime(event.start_time)}
                      {event.location ? ` · ${event.location}` : ''}
                    </span>
                    {event.is_official ? (
                      <span className="mt-1 block">
                        <Badge tone="accent">Official</Badge>
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </RailCard>
      ) : null}

      {marketplace.length ? (
        <RailCard
          variant="island"
          elevation={1}
          tone="sand"
          className="rail-island rail-island--market"
          icon="tag"
          title="Marketplace"
          action={
            <Link href={ROUTES.market} className="text-2xs font-semibold text-muted hover:text-ink">
              Open
            </Link>
          }
        >
          <ul className="rail-market">
            {marketplace.map((item) => {
              const free = item.meta?.is_free === true;
              const price = item.meta?.price != null ? `₹${item.meta.price}` : null;
              return (
                <li key={`rail-listing-${item.id}`}>
                  <Link href={ROUTES.listing(item.id)} className="rail-market__item hover:no-underline">
                    <span className="rail-market__title">{item.title}</span>
                    {free || price ? (
                      <span className="rail-market__price" data-free={free ? 'true' : undefined}>
                        {free ? 'Free' : price}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </RailCard>
      ) : null}

    </aside>
  );
}
