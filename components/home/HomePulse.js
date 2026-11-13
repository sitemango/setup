import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { AnimatedStat } from '@/components/home/AnimatedStat';

/**
 * The threshold combines the personalized greeting with campus shortcuts.
 * The counts remain sourced from the loaded feed.
 */

/**
 * The campus areas that exist as routes, offered *after* the feed as the page's
 * "keep going" row. No counts, no invented activity.
 *
 * Gigs remains here after moving out of the hero; the four primary shortcuts
 * are offered above the feed instead.
 */
const DISCOVERY = [
  { href: ROUTES.explore, label: 'Explore', icon: 'search' },
  { href: ROUTES.gigs, label: 'Gigs', icon: 'briefcase' },
  { href: ROUTES.communities, label: 'Communities', icon: 'users' },
  { href: '/explore/projects', label: 'Projects', icon: 'grid' },
  { href: ROUTES.market, label: 'Marketplace', icon: 'tag' },
];

export function HomePulse({ user, stats = [], children }) {
  const name = (user.profile.display_name || user.profile.username).split(' ')[0];
  return (
    <section className="home-pulse" aria-labelledby="home-greeting">
      <div className="home-pulse__grid">
        <div className="home-pulse__intro min-w-0">
          <p className="home-pulse__eyebrow">
            PCCOE · CAMPUS FEED
          </p>
          <h1 id="home-greeting" className="home-pulse__title">
            <span className="home-pulse__greet">Hey,</span>{' '}
            <span className="home-pulse__name">
              <span className="home-pulse__name-text" title={name}>{name}</span>.
            </span>
          </h1>
          <p className="home-pulse__lead">Here&apos;s what&apos;s happening around campus today.</p>
          {children}
          {stats.length ? (
            <dl
              className="home-pulse__stats"
              style={{ '--home-stat-count': stats.length }}
              aria-label="Campus right now"
            >
              {stats.map((stat) => (
                <div className="home-pulse__stat" key={stat.label} data-empty={stat.value === 0 ? 'true' : undefined}>
                  <dt>{stat.label}</dt>
                  <dd><AnimatedStat value={stat.value} /></dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>

      </div>

    </section>
  );
}

/**
 * The page's "keep going" row: the campus areas that are not already in the
 * primary rail. It sits after the feed so the first screen stays short, and it
 * is a plain list of real destinations — nothing here filters or counts.
 */
export function HomeAreas() {
  return (
    <nav className="home-discover" aria-label="More campus areas">
      <span className="home-discover__label">Keep exploring</span>
      {DISCOVERY.map((item) => (
        <Link key={item.href} href={item.href} className="discover-chip">
          <Icon name={item.icon} size={13} />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * A zone heading: the page's spine. One per movement — the feed, and anything
 * else that needs to announce itself further down.
 */
export function HomeZone({ eyebrow, title, note = null, aside = null, id = null }) {
  return (
    <header className="home-zone">
      <div className="min-w-0">
        {eyebrow ? <p className="home-zone__eyebrow">{eyebrow}</p> : null}
        <h2 id={id} className="home-zone__title">
          {title}
        </h2>
      </div>
      {note ? <p className="home-zone__note">{note}</p> : null}
      {aside}
    </header>
  );
}

/**
 * The page's exit: a rule, one line of plain speaking, and nothing else. It
 * exists so the feed ends deliberately rather than trailing off into the shell.
 */
export function HomeCoda({ children }) {
  return (
    <p className="home-coda">
      <span>{children}</span>
    </p>
  );
}
