import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { getTimetableHref } from '@/lib/timetable/meta';
import { toShellUser } from '@/lib/identity/shell-user';
import { AppShell } from '@/components/layout/AppShell';
import { getUnreadMessageState } from '@/lib/data/messaging';

// Every page in this group depends on the signed-in student, so nothing here is
// cached: a page rendered for one student must never be served to another.
export const dynamic = 'force-dynamic';

/**
 * The authenticated application frame.
 *
 * Every route in this group takes the same path: resolve the session, apply the
 * account/onboarding gate, then render inside the shell so desktop and mobile
 * keep the same navigation. Authorization *inside* each page is enforced again
 * by RLS and by `can(...)` — this layout only decides whether the frame shows.
 *
 * The Create menu is built here, on the server, so the browser never decides
 * what a student is allowed to publish.
 */
export default async function AppLayout({ children }) {
  const user = await requireUser();
  const actor = toActor(user);

  // Unread badge: the count is the recipient's own rows, so RLS does the
  // filtering for us.
  let unread = 0;
  let initialUnreadMessages = [];
  const supabase = await getServerClient();
  if (supabase) {
    const [notificationResult, messageState] = await Promise.all([
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null),
      getUnreadMessageState(supabase),
    ]);
    unread = notificationResult.count || 0;
    initialUnreadMessages = messageState.rows;
  }

  const createItems = [
    ...(can(actor, 'create_posts')
      ? [
          { href: '/home', label: 'Post or poll', icon: 'comment' },
          { href: '/home?kind=discussion', label: 'Discussion', icon: 'chat' },
        ]
      : []),
    ...(can(actor, 'create_marketplace_listing') ? [{ href: '/market/new', label: 'Marketplace listing', icon: 'tag' }] : []),
    ...(can(actor, 'create_gigs') ? [{ href: ROUTES.gigNew, label: 'Gig', icon: 'briefcase' }] : []),
    ...(can(actor, 'create_communities')
      ? [
          { href: '/communities/new', label: 'Community', icon: 'users' },
          { href: '/communities/new?kind=study_group', label: 'Study group', icon: 'book' },
        ]
      : []),
    ...(can(actor, 'manage_clubs') ? [{ href: ROUTES.clubNew, label: 'Club', icon: 'star' }] : []),
    ...(can(actor, 'create_lost_found') ? [{ href: '/campus/lost-found/new', label: 'Lost & found', icon: 'search' }] : []),
    ...(can(actor, 'create_team_posts') ? [{ href: '/campus/teams/new', label: 'Team post', icon: 'sparkle' }] : []),
    ...(can(actor, 'create_study_posts') ? [{ href: '/campus/study/new', label: 'Study request', icon: 'book' }] : []),
    ...(can(actor, 'submit_events') ? [{ href: '/campus/events/new', label: 'Event submission', icon: 'calendar' }] : []),
    ...(can(actor, 'submit_resources') ? [{ href: '/explore/resources/new', label: 'Resource', icon: 'book' }] : []),
    ...(can(actor, 'submit_opportunities') ? [{ href: '/explore/opportunities/new', label: 'Opportunity', icon: 'briefcase' }] : []),
    ...(can(actor, 'create_projects') ? [{ href: '/explore/projects/new', label: 'Project', icon: 'sparkle' }] : []),
  ];

  // Quick Actions palette: the same server-side permission checks as the Create
  // menu, so the browser never decides what is available. Destinations enforce
  // authorization independently — hiding an action here grants nothing.
  const canModerate = can(actor, 'review_reports');
  const canAdmin = can(actor, 'view_audit_logs') || can(actor, 'manage_platform_settings');
  const paletteActions = [
    { section: 'Navigation', label: 'Home', href: '/home', icon: 'home' },
    { section: 'Navigation', label: 'Explore', href: '/explore', icon: 'search' },
    { section: 'Navigation', label: 'Messages', href: '/chat', icon: 'chat' },
    { section: 'Navigation', label: 'Notifications', href: '/notifications', icon: 'bell' },
    { section: 'Navigation', label: 'Communities', href: '/communities', icon: 'users' },
    { section: 'Navigation', label: 'Campus', href: '/campus', icon: 'building' },
    { section: 'Navigation', label: 'Events', href: '/campus/events', icon: 'calendar' },
    { section: 'Navigation', label: 'Study partner finder', href: '/campus/study', icon: 'book' },
    { section: 'Navigation', label: 'Team finder', href: '/campus/teams', icon: 'users' },
    { section: 'Navigation', label: 'Gigs', href: ROUTES.gigs, icon: 'briefcase' },
    { section: 'Navigation', label: 'Clubs', href: ROUTES.clubs, icon: 'star' },
    { section: 'Navigation', label: 'Noticeboard', href: '/campus/noticeboard', icon: 'megaphone' },
    // Timetable is public; the saved profile division only personalises
    // where this shortcut lands (division page vs. selector).
    { section: 'Navigation', label: 'Timetable', href: getTimetableHref(user.profile?.division), icon: 'calendar', keywords: 'schedule classes lectures division' },
    { section: 'Navigation', label: 'Resources', href: '/explore/resources', icon: 'book' },
    { section: 'Navigation', label: 'Projects', href: '/explore/projects', icon: 'sparkle' },
    { section: 'Navigation', label: 'Opportunities', href: '/explore/opportunities', icon: 'briefcase' },
    { section: 'Navigation', label: 'Market', href: '/market', icon: 'tag' },
    { section: 'Navigation', label: 'Profile', href: '/profile', icon: 'user' },
    { section: 'Navigation', label: 'Settings', href: '/settings', icon: 'settings' },
    { section: 'Navigation', label: 'First-visit guide', href: ROUTES.guide, icon: 'mapPin', keywords: 'new here orientation what is campus plus where is everything' },
    ...(canModerate ? [{ section: 'Navigation', label: 'Moderation', href: '/moderator', icon: 'shield' }] : []),
    ...(canAdmin ? [{ section: 'Navigation', label: 'Admin', href: '/admin', icon: 'eye' }] : []),
    ...createItems.map((item) => ({ ...item, section: 'Create' })),
    { section: 'Actions', label: 'Search discussions', href: '/explore?scope=discussions', icon: 'comment', keywords: 'questions answers' },
    { section: 'Actions', label: 'Calendar view', href: '/campus/events?view=calendar', icon: 'calendar', keywords: 'month agenda' },
    { section: 'Actions', label: 'Lost & found', href: '/campus/lost-found', icon: 'search', keywords: 'lost found items' },
    { section: 'Actions', label: 'Campus utilities', href: '/campus/utilities', icon: 'building', keywords: 'directory services transport cafeteria' },
    { section: 'Actions', label: 'Community rules', href: '/rules', icon: 'shield', keywords: 'guidelines policy' },
  ];

  // The shell gets the adapter's five fields — never the session, the auth id,
  // the email or the resolved permission set.
  const shellUser = toShellUser(user);

  return (
    <AppShell
      user={shellUser}
      unreadNotifications={unread}
      messagingUserId={user.profile.id}
      feedUserId={user.profile.id}
      initialUnreadMessages={initialUnreadMessages}
      canModerate={canModerate}
      canAdmin={canAdmin}
      createItems={createItems}
      paletteActions={paletteActions}
    >
      {children}
    </AppShell>
  );
}
