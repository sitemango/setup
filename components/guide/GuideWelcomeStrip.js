'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { deviceStorage, GUIDE_SEEN_KEY, markGuideSeen, readGuideSeen, shouldOfferGuide } from '@/lib/guide/first-visit';

/**
 * The one-line offer on Home, for a device that has not opened the guide yet.
 *
 * It is a strip, not a modal: Home is where a new student lands, and a dialog
 * over a feed on someone's first minute is the opposite of a welcome. Dismissing
 * it is a choice, not a countdown — a cool-off timer is for a prompt that installs
 * something; this one just stops repeating itself.
 *
 * The flag is read through `useSyncExternalStore`, which is the one correct way to
 * look at `localStorage` from a server-rendered page. The server and first
 * hydration pass emit the offer so a new device never inserts it above a painted
 * feed. A static pre-paint style hides that SSR node on devices whose stored flag
 * is already set, then the store's value removes it as the tree goes live. No
 * effect, no setState during one, and no post-paint offer insertion.
 *
 * Storage is treated as an expectation, not a guarantee: private windows and
 * blocked-storage WebViews read back `null`, in which case the strip still offers
 * itself (that student may need it most) and the button says "for now", because
 * promising a permanent dismissal the browser cannot keep would be a lie. The
 * local `dismissed` flag then covers the click itself, so the strip closes either
 * way.
 */

/** Another tab reading the guide should settle this one, without polling. */
function subscribe(onChange) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => {
    if (!event || event.key === null || event.key === GUIDE_SEEN_KEY) onChange();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

function readSnapshot() {
  // `deviceStorage()`, because the property read is what some builds throw on.
  return readGuideSeen(deviceStorage());
}

/** Reserve the real offer in SSR; the pre-paint script handles prior dismissal. */
function readServerSnapshot() {
  return false;
}

export function GuideWelcomeStrip() {
  const pathname = usePathname();
  const seen = useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot);
  const [dismissed, setDismissed] = useState(false);

  const dismiss = useCallback(() => {
    markGuideSeen(deviceStorage());
    // The local flag is what actually closes it. Whether the browser kept the
    // answer decides only whether it comes back on the next load.
    setDismissed(true);
  }, []);

  if (!shouldOfferGuide({ seen, onHome: pathname === ROUTES.home, hidden: dismissed })) return null;

  return (
    <aside className="guide-strip" data-storage={seen === null ? 'unavailable' : 'local'}>
      <span className="guide-strip__tape" aria-hidden="true" />
      <p className="guide-strip__lead">
        <Icon name="mapPin" size={15} />
        New to Campus+? There is a two-minute guide to where everything is.
      </p>
      <div className="guide-strip__actions">
        {/* Opening the guide marks it seen (the page does that itself), so this
            link is the whole of the first-visit flow. */}
        <Link href={ROUTES.guide} className="guide-strip__link">
          Open the guide
          <Icon name="arrowUpRight" size={13} />
        </Link>
        {/* When storage cannot be read the label promises nothing it cannot do:
            "for now" is the truth in a private window. */}
        <button type="button" className="guide-strip__dismiss" onClick={dismiss}>
          {seen === null ? 'Dismiss for now' : 'Don’t show this again'}
        </button>
      </div>
    </aside>
  );
}
