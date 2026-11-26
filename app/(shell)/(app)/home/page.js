import { requireUser } from '@/lib/auth/session';
import { can, isInstitutional, isVisitor, toActor } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { HomeFeedClient } from '@/components/home/HomeFeedClient';
import { HomeAreas, HomeCoda } from '@/components/home/HomePulse';
import { HomeFeatureTiles } from '@/components/home/HomeFeatureTiles';
import { Notice } from '@/components/ui';

export const metadata = {
  title: 'Home',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

/** Modules worth one tap from the contextual rail — real destinations. */
const QUICK_LINKS = [
  { href: '/campus/noticeboard', label: 'Noticeboard', icon: 'megaphone' },
  { href: '/campus/events', label: 'Events', icon: 'calendar' },
  { href: '/campus/lost-found', label: 'Lost & found', icon: 'search' },
  { href: '/explore/resources', label: 'Resources', icon: 'book' },
  { href: '/explore/opportunities', label: 'Opportunities', icon: 'trend' },
  { href: ROUTES.clubs, label: 'Clubs', icon: 'star' },
  { href: ROUTES.gigs, label: 'Gigs', icon: 'briefcase' },
];

/**
 * Home renders its personalized frame immediately. Feed and rail data are
 * loaded after hydration through an authenticated, no-store endpoint; the
 * client keeps at most ten per-user entries in memory for quick return visits.
 */
export default async function HomePage() {
  const user = await requireUser();
  const actor = toActor(user);
  const profile = user.profile;
  const userId = profile.id;

  // External accounts can also read published Home posts. The noticeboard shortcut points at
  // a campus-internal surface, so it is not offered to them.
  const institutional = isInstitutional(actor);
  const visitor = isVisitor(actor);
  const quickLinks = institutional
    ? QUICK_LINKS
    : QUICK_LINKS.filter((link) => link.href !== '/campus/noticeboard');
  const homeUser = {
    profile: {
      username: profile.username,
      display_name: profile.display_name,
    },
  };

  return (
    <div className="home-stage">
      {visitor ? (
        <Notice tone="neutral" icon="info">
          You are signed in as a Visitor. You can read published Home posts and public content, follow clubs and events,
          and manage your own profile. Publishing is disabled unless a Campus+ administrator
          grants it to your account.
        </Notice>
      ) : null}
      <HomeFeedClient
        key={userId}
        user={homeUser}
        userId={userId}
        currentUserId={userId}
        canPost={can(actor, 'create_posts')}
        canModerate={can(actor, 'remove_posts')}
        heroFeatures={<HomeFeatureTiles division={profile.division} institutional={institutional} />}
        afterFeed={<HomeAreas />}
        quickLinks={quickLinks}
      />
      <HomeCoda>
        Campus+ is an unofficial student project — no algorithmic ranking, no AI, no advertising. Feed order is
        deterministic and configured in the database.
      </HomeCoda>
    </div>
  );
}
