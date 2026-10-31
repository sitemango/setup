import { NightSky } from '@/components/atmosphere/NightSky';
import { Sidebar } from '@/components/layout/Sidebar';
import { ShellHeader } from '@/components/layout/ShellHeader';
import { BottomNav } from '@/components/layout/BottomNav';
import { CommandPaletteHost } from '@/components/search/CommandPalette';
import { isStaffRoles } from '@/lib/identity/shell-user';
import { MessagingProvider } from '@/components/layout/MessagingProvider';
import { LiveFeedProvider } from '@/components/layout/LiveFeedProvider';
import { NavigationTour } from '@/components/navigation/NavigationTour';

/**
 * The one application frame.
 *
 * Desktop: a floating glass rail with the brand, the Create action and
 * navigation, plus a floating glass header carrying search, notifications and
 * the account.
 * Mobile: a compact glass header and the bottom tab bar, with everything else
 * behind the menu sheet.
 *
 * The content column is deliberately narrow for reading; pages that need a
 * contextual rail opt in with `.page-grid` and the shell widens itself.
 *
 * `user` is the shell identity produced by `toShellUser()` — five fields, not a
 * session. Pass `null` for public screens such as /login.
 *
 * `unreadNotifications` is measured once per request in the layout and handed
 * to every surface that shows it (header, sidebar, menu). No surface queries
 * the count itself, so the three numbers can never disagree.
 *
 * `messagingUserId` and `feedUserId` are the same profile id, and each provider
 * owns exactly one live subscription for the tab. The feed one exists so a post
 * published by someone else reaches an already-open feed — see
 * `components/layout/LiveFeedProvider`.
 */
export function AppShell({
  user = null,
  unreadNotifications = 0,
  messagingUserId = null,
  feedUserId = null,
  initialUnreadMessages = [],
  canModerate = false,
  canAdmin = false,
  createItems = [],
  paletteActions = [],
  children,
}) {
  // Staff-ness is derived by the identity adapter, not re-guessed here.
  const isStaff = Boolean(user?.staffLabel) || isStaffRoles(user?.roles);

  return (
    <MessagingProvider
      key={messagingUserId || 'signed-out'}
      userId={messagingUserId}
      initialUnread={initialUnreadMessages}
    >
      <LiveFeedProvider key={feedUserId || 'signed-out'} userId={feedUserId}>
        <div className="min-h-dvh">
          <NightSky />
          <a href="#content" className="skip-link">
            Skip to content
          </a>

          <Sidebar
            user={user}
            unreadNotifications={unreadNotifications}
            isStaff={isStaff}
            canModerate={canModerate}
            canAdmin={canAdmin}
            createItems={createItems}
          />

          {/* `.shell-root` lifts the chrome and the page above the fixed night
              sky, which is a positioned layer and would otherwise paint over
              static content. */}
          <div className="shell-root lg:pl-[17rem]">
            <ShellHeader
              user={user}
              unreadNotifications={unreadNotifications}
              isStaff={isStaff}
              canModerate={canModerate}
              canAdmin={canAdmin}
              createItems={createItems}
            />

            <main
              id="content"
              className="shell-content shell-main mx-auto w-full px-4 pb-28 pt-4 sm:px-6 lg:pb-16 lg:pt-5"
            >
              {children}
            </main>
          </div>

          <BottomNav />
          <NavigationTour
            canModerate={canModerate}
            canAdmin={canAdmin}
            canCreate={createItems.length > 0}
            isStaff={isStaff}
          />
          <CommandPaletteHost actions={paletteActions} />
        </div>
      </LiveFeedProvider>
    </MessagingProvider>
  );
}
