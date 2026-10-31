import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { DepthField } from '@/components/atmosphere/DepthField';
import { HomeFeedClient } from '@/components/home/HomeFeedClient';
import { HomeAreas, HomeCoda } from '@/components/home/HomePulse';
import { HomeFeatureTiles } from '@/components/home/HomeFeatureTiles';
import { GuideWelcomeStrip } from '@/components/guide/GuideWelcomeStrip';
import { GUIDE_SEEN_PREHYDRATION_SCRIPT, GUIDE_SEEN_STYLE_ID } from '@/lib/guide/first-visit';

export const metadata = { title: 'Home' };

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
  const homeUser = {
    profile: {
      username: profile.username,
      display_name: profile.display_name,
      branch: profile.branch,
      show_branch_year: profile.show_branch_year,
    },
  };

  return (
    <div className="home-stage">
      {/* Emit the offer with Home's first HTML so it cannot insert itself above
          a painted feed. A returning device's static pre-paint style hides the
          SSR node until hydration removes it. No account data is involved. */}
      <script id={`${GUIDE_SEEN_STYLE_ID}-script`}>{GUIDE_SEEN_PREHYDRATION_SCRIPT}</script>
      <GuideWelcomeStrip />
      {/* Decorative only; the feed and rail do not wait for Supabase queries. */}
      <DepthField />
      <HomeFeedClient
        key={userId}
        user={homeUser}
        userId={userId}
        currentUserId={userId}
        canPost={can(actor, 'create_posts')}
        canModerate={can(actor, 'remove_posts')}
        heroFeatures={<HomeFeatureTiles division={profile.division} />}
        afterFeed={<HomeAreas />}
        quickLinks={QUICK_LINKS}
      />
      <HomeCoda>
        Campus+ is an unofficial student project — no algorithmic ranking, no AI, no advertising. Feed order is
        deterministic and configured in the database.
      </HomeCoda>
    </div>
  );
}
