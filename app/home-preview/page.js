import { HomeFeedNavigation } from '@/components/home/HomeFeedNavigation';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { toShellUser } from '@/lib/identity/shell-user';
import { AppShell } from '@/components/layout/AppShell';
import { Notice } from '@/components/ui';
import { HomeComposer } from '@/components/home/HomeComposer';
import { IslandMotion } from '@/components/home/IslandMotion';
import { HomePulse, HomeZone, HomeAreas, HomeCoda } from '@/components/home/HomePulse';
import { HomeFeatureTiles } from '@/components/home/HomeFeatureTiles';
import { HomeRail } from '@/components/home/HomeRail';
import { StreamItem, StreamSlot } from '@/components/home/StreamItem';

export const metadata = {
  title: 'Home — demo preview',
  description: 'Development-only preview of the signed-in Campus+ home page with sample data.',
};

/**
 * Signed-in Home demo preview (development only).
 *
 * This route exists so the signed-in Home can be reviewed without a real
 * account or backend: it renders the *real* AppShell and the *real* Home
 * components (greeting, feature tiles, composer, feed stream and rail) fed
 * with clearly-labelled sample data for a fictional demo student. It is not
 * a session and grants nothing — the page answers 404 outside development,
 * sample links that leave the demo land on the real (protected) routes, and
 * the composer is inert so nothing can be published from here.
 *
 * The real `/home` is untouched: it still resolves the actual signed-in
 * student through `requireUser()` and the live feed API.
 */

const DEMO_USER = {
  profile: {
    username: 'demo_student',
    display_name: 'Demo Student',
    branch: 'Computer Engineering',
    show_branch_year: true,
    division: null,
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (offset) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

const DEMO_FEED = [
  {
    type: 'notice',
    id: 'demo-notice-1',
    title: 'Demo notice: end-semester examination timetable published',
    body: 'Sample entry for this preview. On the real Noticeboard, official notices from the examination cell appear in the feed exactly like this.',
    isOfficial: true,
    createdAt: isoDay(-1),
    meta: { category: 'Examinations', importance: 'high' },
  },
  {
    type: 'post',
    id: 'demo-post-1',
    post: {
      id: 'demo-post-1',
      author_id: 'demo-meera',
      author_username: 'meera_demo',
      author_display_name: 'Meera (demo)',
      body: 'Demo post: DBMS unit 3 study group forming for Thursday evening in the library (Building 11). Bring your own notes — sample content only, nobody real posted this.',
      created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      kind: 'post',
      comment_count: 3,
      reaction_count: 12,
    },
  },
  {
    type: 'event',
    id: 'demo-event-1',
    title: 'Demo event: campus clubs showcase',
    body: 'Sample event entry. Real events carry their date plate, time and venue from the events calendar.',
    isOfficial: false,
    meta: { starts_on: isoDay(2), start_time: '10:00', location: 'Open Space (Lawn)', organizer: 'Student Council (demo)' },
  },
  {
    type: 'opportunity',
    id: 'demo-opportunity-1',
    title: 'Demo opportunity: summer research internship applications',
    body: 'Sample opportunity entry with its offering organisation and closing date, as published on Explore.',
    isOfficial: true,
    meta: { organization: 'Research Cell (demo)', deadline: isoDay(14) },
  },
  {
    type: 'deal',
    id: 'demo-listing-1',
    title: 'Demo listing: engineering drawing kit, barely used',
    body: 'Sample marketplace entry. Price leads, the way listings are read.',
    authorUsername: 'kabir_demo',
    meta: { is_free: false, price: 450, condition: 'Good' },
  },
];

const DEMO_RAIL = {
  events: [
    { id: 'demo-event-1', title: 'Campus clubs showcase (demo)', starts_on: isoDay(2), start_time: '10:00', location: 'Open Space (Lawn)', is_official: false },
    { id: 'demo-event-2', title: 'Guest lecture: building for the web (demo)', starts_on: isoDay(5), start_time: '14:00', location: 'Building 6, Academic Building', is_official: true },
  ],
  notices: [
    { id: 'demo-notice-1', title: 'End-semester examination timetable published (demo)', category: 'Examinations', importance: 'high', published_at: isoDay(-1) },
    { id: 'demo-notice-2', title: 'Library will stay open till 9 PM this week (demo)', category: 'Library', importance: 'normal', published_at: isoDay(-2) },
  ],
  trending: [
    { id: 'demo-post-1', body: 'DBMS unit 3 study group forming for Thursday evening… (demo)', score: 18, reaction_count: 12, comment_count: 3 },
    { id: 'demo-post-2', body: 'Best misal near Akurdi station? Asking for the whole hostel… (demo)', score: 11, reaction_count: 8, comment_count: 5 },
  ],
  marketplace: [
    { id: 'demo-listing-1', title: 'Engineering drawing kit (demo)', meta: { is_free: false, price: 450 } },
    { id: 'demo-listing-2', title: 'Scientific calculator (demo)', meta: { is_free: true } },
  ],
};

const DEMO_STATS = [
  { label: 'Posts in feed', value: DEMO_FEED.length },
  { label: 'Notices published', value: DEMO_RAIL.notices.length },
];

const DEMO_CREATE_ITEMS = [{ href: '/home-preview', label: 'Post or poll (demo)', icon: 'comment' }];

const DEMO_PALETTE_ACTIONS = [
  { section: 'Navigation', label: 'Home (demo preview)', href: '/home-preview', icon: 'home' },
  { section: 'Navigation', label: 'Campus map', href: ROUTES.map, icon: 'mapPin', keywords: 'map campus buildings location grounds gates' },
  { section: 'Navigation', label: 'Timetable', href: ROUTES.timetable, icon: 'calendar' },
  { section: 'Navigation', label: 'Noticeboard', href: '/campus/noticeboard', icon: 'megaphone' },
  { section: 'Navigation', label: 'Events', href: '/campus/events', icon: 'calendar' },
  { section: 'Navigation', label: 'Clubs', href: ROUTES.clubs, icon: 'star' },
];

export default function HomePreviewPage() {
  // Local-only preview, following the `/guide/intro-preview` precedent:
  // outside development this route does not exist.
  if (process.env.NODE_ENV !== 'development') notFound();

  const shellUser = toShellUser({ profile: DEMO_USER.profile, roles: [] });

  return (
    <AppShell
      user={shellUser}
      unreadNotifications={2}
      messagingUserId={null}
      feedUserId={null}
      initialUnreadMessages={[]}
      createItems={DEMO_CREATE_ITEMS}
      paletteActions={DEMO_PALETTE_ACTIONS}
    >
      <div className="home-stage">
        <div className="mb-4">
          <Notice tone="neutral" icon="eye">
            <strong>Demo preview — signed-in Home with sample data.</strong> You are seeing the real home page
            as a fictional student (@demo_student). Nothing here is a real account or post, and the composer is
            disabled. <Link href={ROUTES.map} className="font-semibold text-accent-ink hover:underline">Open the corrected Campus Map →</Link>
          </Notice>
        </div>

        <IslandMotion>
          <div className="home-body">
            <div className="home-body__main">
              <HomePulse user={DEMO_USER} stats={DEMO_STATS}>
                <HomeFeatureTiles division={DEMO_USER.profile.division} />
              </HomePulse>
              <HomeZone id="home-stream-title" title="Campus feed" />
              <div inert>
                <HomeComposer authorName={DEMO_USER.profile.display_name} authorUsername={DEMO_USER.profile.username} />
              </div>

              <section className="flex flex-col gap-4" aria-labelledby="home-stream-title">
                <HomeFeedNavigation />
                <div className="home-stream">
                  {DEMO_FEED.map((item, index) => (
                    <StreamSlot key={`${item.type}-${item.id}`} kind={item.type} order={index}>
                      <StreamItem
                        item={item}
                        post={item.post || null}
                        currentUserId="demo-student"
                        canModerate={false}
                        reactions={{ count: item.post?.reaction_count || 0, mine: false }}
                      />
                    </StreamSlot>
                  ))}
                </div>

                <Link href={ROUTES.map} className="self-start text-xs font-semibold text-accent-ink hover:underline">
                  Find a building on the Campus Map →
                </Link>
              </section>

              <HomeAreas />
            </div>

            <HomeRail events={DEMO_RAIL.events} notices={DEMO_RAIL.notices} trending={DEMO_RAIL.trending} marketplace={DEMO_RAIL.marketplace} />
          </div>
        </IslandMotion>

        <HomeCoda>
          Demo preview only — Campus+ itself is an unofficial student project with no algorithmic ranking, no AI and no advertising.
        </HomeCoda>
      </div>
    </AppShell>
  );
}
