import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { describeAuthError, safeNextPath } from '@/lib/auth/oauth';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { Notice } from '@/components/ui';
import { BrandLockup } from '@/components/brand/Brand';
import { IndependenceNotice } from '@/components/brand/IndependenceNotice';
import { LoginForm } from '@/components/auth/LoginForm';
import { GhostScene } from '@/components/atmosphere/GhostScene';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * Sign-in (spec §7). Google OAuth only: the student picks their institutional
 * Google account, and the domain rule is enforced server-side after the
 * callback, never by anything typed on this screen.
 *
 * `/auth/callback` sends failures back here as `?error=<code>`; old one-time
 * code links arrive as `?notice=google` (see /login/verify).
 *
 * The composition keeps the existing sign-in, disclosure and guide content in
 * the same order. Lumen owns the foreground while the original mouse-reactive
 * ghost atmosphere remains at the user's explicit request. OAuth behavior and
 * callback error handling are unchanged.
 */
export default async function LoginPage({ searchParams }) {
  if (!isSupabaseConfigured()) redirect('/setup');

  const user = await getCurrentUser();
  if (user && !user.needsProfileSetup) redirect(ROUTES.home);
  if (user && user.needsProfileSetup) redirect('/onboarding');

  const params = await searchParams;
  const next = safeNextPath(params?.next);
  const callbackError = describeAuthError(params?.error);
  const notice =
    params?.notice === 'google'
      ? 'Campus+ now signs in with Google. Use the button below with your @pccoepune.org account.'
      : null;

  return (
    <div className="login-stage cinematic-stage min-h-dvh">
      {/* Retained original sign-in atmosphere: pointer/touch-reactive WebGL,
          static fallback without WebGL, and one still frame for reduced motion. */}
      <GhostScene />
      <div className="login-vignette" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-5 py-10 sm:py-14">
        {/* The original background scrim preserves foreground contrast over the
            ghost; the form itself uses the new solid Lumen controls. */}
        <span className="login-cta-scrim" aria-hidden="true" />
        {/* Brand area: the logo carries the identity before a single word is read. */}
        <div className="login-intro login-sky flex flex-col items-start">
          <BrandLockup href="/" size="lg" className="login-halo w-fit" wordClass="text-[1.3125rem]" markPriority />
          {/* The independence label stays with the brand; the crest itself
              appears once, beside the full disclosure by the controls below. */}
          <p className="t-label mt-6">Unofficial student project</p>
          {/* The headline is set as a poster title: one phrase per line, each
              sized so it fills the column edge to edge (see `.login-title`).
              The line break is explicit and the two lines stay independent
              boxes, so "in one place" can take the warm ash falloff. */}
          <h1 className="login-title mt-3">
            <span className="login-title-line">The campus,</span>
            <span className="login-title-line login-title-accent">in one place</span>
          </h1>
          <span className="login-rule" aria-hidden="true" />
          <p className="t-secondary mt-3 max-w-md">
            Sign in with your PCCOE Google account. There is no password and no code to remember.
          </p>
        </div>

        {/* The sign-in action, directly beneath the introduction. Notices follow it. */}
        <div className="mt-7">
          <LoginForm next={next}>
            {callbackError ? (
              <Notice tone="danger" icon="flag">
                {callbackError}
              </Notice>
            ) : null}
            {notice ? (
              <Notice tone="accent" icon="sparkle">
                {notice}
              </Notice>
            ) : null}
          </LoginForm>
        </div>

        {/* Independence disclosure: reading-size, beside the sign-in controls
            and visible before authentication on every viewport. The crest
            identifies the institution referred to; it confers no affiliation. */}
        <IndependenceNotice className="login-intro mt-6" />

        <ul className="login-intro login-sky mt-9 flex flex-col gap-2.5 text-[0.8125rem] text-muted">
          <li className="flex items-start gap-2.5">
            <span className="login-fact">
              <Icon name="mail" size={15} />
            </span>
            <span>
              Only <span className="font-semibold text-ink">@pccoepune.org</span> accounts can sign in.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="login-fact">
              <Icon name="lock" size={15} />
            </span>
            <span>Your email stays private. Other students only ever see your @username.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="login-fact">
              <Icon name="users" size={15} />
            </span>
            <span>Text-first by design: posts, discussions, communities and messages.</span>
          </li>
        </ul>

        <p className="login-intro login-sky mt-8 text-2xs leading-relaxed text-muted">
          By continuing you agree to keep the space respectful and to follow the{' '}
          <Link href="/rules" className="font-semibold text-ink underline">
            community rules
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
