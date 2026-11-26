import Link from 'next/link';
import '@/app/styles/timetable.css';
import '@/app/styles/lumen.css';
import '@/app/styles/aurora.css';
import '@/app/styles/liquid-glass.css';
import { BrandLockup } from '@/components/brand/Brand';
import { getTimetableSourceForDate } from '@/lib/timetable/meta';
import { ROUTES } from '@/lib/constants';

/**
 * The timetable's own viewport, declared here because it is the whole
 * `/timetable` subtree that behaves like an installed app.
 *
 * `viewport-fit: cover` is the one field that is not decoration: without it the
 * browser never gives the page the notch/home-indicator area, so `env(safe-area-inset-*)`
 * in the install card and the offline shell resolves to 0 and the bottom action
 * sits under the iOS home indicator in `display: standalone`. The other fields
 * restate the root viewport deliberately — a nested `viewport` export replaces
 * fields rather than adding to them, and the timetable must not lose
 * `width=device-width` by accident. Browser chrome stays in the root document
 * metadata so every route has one value for the theme synchronizer.
 */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

/**
 * Public chrome for the timetable pages.
 *
 * These routes are deliberately OUTSIDE the authenticated app shell: a
 * first-year student with a shared link and no account must be able to open
 * their division's timetable in a fresh tab. The frame is the same public
 * pattern as /legal — Campus+ wordmark, a way back into the app (which
 * routes signed-out visitors to sign-in and signed-in students home), and
 * an honest source footer.
 */
export default function TimetableLayout({ children }) {
  // Which week this is printed as — the special sheet gets its own name in
  // the source line while it is in effect; the master does otherwise.
  const source = getTimetableSourceForDate(new Date());

  return (
    <div className="tt-shell mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BrandLockup href="/" size="lg" className="w-fit" />
        <Link
          href={ROUTES.home}
          className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] border border-line px-3.5 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-line-strong hover:no-underline"
        >
          Open Campus+
        </Link>
      </div>

      <nav aria-label="Timetable navigation" className="mt-8 flex flex-wrap gap-3 text-sm font-semibold">
        <a href={ROUTES.timetable} className="rounded-[var(--radius-md)] border border-line px-4 py-2 text-ink hover:border-line-strong">Timetable</a>
        <Link href="/timetable/fa-ii" className="rounded-[var(--radius-md)] border border-line px-4 py-2 text-ink hover:border-line-strong">FA-II Timetable</Link>
      </nav>

      {children}

      <footer className="mt-14 border-t border-line pt-6">
        <p className="max-w-[75ch] text-[0.8125rem] leading-relaxed text-muted">
          Class timetable source: {source.title} — {source.department}, Academic Year{' '}
          {source.academicYear}, {source.semester} ({source.fileTitle}). Subject
          codes, batch splits, faculty initials and room numbers are reproduced as printed; where the timetable
          changes, official department notices prevail over this page.
        </p>
        <p className="mt-2 max-w-[75ch] text-[0.8125rem] leading-relaxed text-muted">
          Campus+ is an independent student project, not an official PCCOE service.{' '}
          <Link href={ROUTES.legal} className="font-semibold text-ink underline underline-offset-2">
            Legal &amp; Institutional Independence
          </Link>
        </p>
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.8125rem]">
          <a href={ROUTES.timetable} className="font-medium text-muted underline hover:text-ink">
            All divisions
          </a>
          <Link href={ROUTES.rules} className="font-medium text-muted underline hover:text-ink">
            Community rules
          </Link>
        </p>
      </footer>
    </div>
  );
}
