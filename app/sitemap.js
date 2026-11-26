import { listPublicClubs } from '@/lib/data/public';
import { listPublishedEvents } from '@/lib/data/public-cache';
import { ROUTES, DIVISIONS, CLUB_SLUG_REGEX, UUID_REGEX } from '@/lib/constants';
import { SITE_URL } from '@/lib/seo';

/**
 * A sitemap of published, explicitly public records only.
 *
 * Both readers go through the anonymous client and the narrow `anon` RLS
 * policies / column grants in migration 041. A draft, a rejected submission, a
 * campus-only or private club, an unpublished event, a member, an attendee and
 * every administrative route are structurally incapable of appearing here —
 * even if someone later adds a broad `select('*')` to one of the readers.
 *
 * A successful sitemap includes the two directories and only records the
 * database confirms are public. Failures return an error rather than caching
 * a partial catalogue as complete.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 300;

function entry(path, lastModified, changeFrequency, priority) {
  return {
    url: new URL(path, `${SITE_URL}/`).toString(),
    lastModified: lastModified || undefined,
    changeFrequency,
    priority,
  };
}

// The public readers use anonymous RLS and tagged caches. Page through the
// catalogue rather than silently dropping everything after the first 500 rows.
async function allPages(reader, options) {
  const items = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const page = await reader({ ...options, limit: size, offset });
    if (page.unavailable) throw new Error('Public sitemap catalogue unavailable');
    items.push(...(page.items || []));
    if ((page.items || []).length < size) return items;
  }
}

export default async function sitemap() {
  const [clubs, events] = await Promise.all([
    allPages(listPublicClubs, { order: 'name' }),
    allPages(listPublishedEvents, { allDates: true }),
  ]);
  const staticEntries = [
    entry('/', null, 'weekly', 1),
    entry('/timetable', null, 'weekly', 0.9),
    ...DIVISIONS.map((division) => entry(`/timetable/${division.toLowerCase()}`, null, 'weekly', 0.8)),
    entry(ROUTES.clubs, null, 'daily', 0.9),
    entry('/campus/events', null, 'daily', 0.8),
  ];
  const clubEntries = clubs
    .filter((club) => CLUB_SLUG_REGEX.test(club.slug || '') && club.kind === 'club' && club.status === 'published' && club.visibility === 'public')
    .map((club) => entry(ROUTES.club(club.slug), club.updated_at, 'weekly', 0.7));
  const eventEntries = events
    .filter((event) => UUID_REGEX.test(event.id || '') && event.status === 'published')
    .map((event) => entry(ROUTES.event(event.id), event.published_at, 'weekly', 0.6));
  // Concurrent changes during paging cannot create duplicate sitemap URLs.
  return [...new Map([...staticEntries, ...clubEntries, ...eventEntries].map((item) => [item.url, item])).values()];
}
