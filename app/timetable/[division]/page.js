import { notFound } from 'next/navigation';
import { DIVISIONS, ROUTES } from '@/lib/constants';
import { adjacentDivisions, getDivisionTimetable } from '@/lib/timetable';
import { getCampusTime, normalizeTimetableDay } from '@/lib/timetable/clock';
import { resolveAutoDay } from '@/lib/timetable/auto-day';
import { divisionTimetableHref } from '@/lib/timetable/meta';
import { batchShortName, describeBatch } from '@/lib/timetable/batch';
import TimetableLive from '@/components/timetable/TimetableLive';
import { TimetableInstallCard, TimetableInstallSheet, TimetableOfflinePill } from '@/components/timetable/TimetableOfflineUi';
import { TimetableOfflineProvider } from '@/components/timetable/TimetableOfflineProvider';
import { FlaggedNotice, WeekTable } from '@/components/timetable/TimetableViews';
import { Icon } from '@/components/ui/icons';
import { publicMetadata } from '@/lib/seo';
import { Notice } from '@/components/ui/surfaces';

/**
 * One division's public timetable, e.g. /timetable/o.
 *
 * Public by design: no session work happens here, so the page works signed
 * out, in a fresh tab, on refresh and from a shared link. Uppercase params
 * (/timetable/O) resolve to the same division; anything that is not a
 * single A–R letter is a real 404 (see not-found.js beside this file).
 *
 * The server resolves the day the schedule is on in Asia/Kolkata — today until
 * its last lecture ends, then the next day with classes — and hands the client
 * that instant plus the resolution, so the first paint already shows the right
 * weekday and clock. Everything after that — the ticking clock, NOW/NEXT
 * moving between periods, the automatic switch when the final lecture ends,
 * and crossing midnight — happens in TimetableLive.
 *
 * The offline layer hangs off this file and nothing else: the provider reads
 * and writes this device's saved copy of *this* division, the pill in the header
 * reports it, and the card below the timetable is the only place on Campus+
 * that offers a home-screen install. `manifest` in the metadata is what makes
 * that install batch-specific — see app/timetable/manifest/[division]/route.js.
 */

// Only A–R exist (both cases, so /timetable/O works like /timetable/o);
// anything else is a router-level 404 into not-found.js.
export const dynamicParams = false;

// The week shown depends on the date (Asia/Kolkata): the special sheet for
// 23–27 November 2026, the master otherwise — and the boundary has to take
// effect at midnight without a redeploy, so this page renders per request
// instead of being prerendered to build-time content.
export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return DIVISIONS.flatMap((division) => [{ division: division.toLowerCase() }, { division }]);
}

export async function generateMetadata({ params }) {
  const { division } = await params;
  const timetable = getDivisionTimetable(division);
  if (!timetable) return { title: 'Timetable not found' };
  const batch = describeBatch(division);
  const programme = timetable.friendly ? `${timetable.label} (${timetable.friendly})` : timetable.label;
  const sourceLabel = timetable.specialWeek ? 'the special one-week timetable' : 'the master timetable';
  return {
    ...publicMetadata({
      title: `PCCOE Division ${timetable.division} timetable — ${programme}`,
      canonical: divisionTimetableHref(timetable.division),
      imageAlt: `Division ${timetable.division} timetable on Campus+`,
      description: `Monday–Friday class timetable for first-year Division ${timetable.division} (${programme}) with the live class for Asia/Kolkata time. Lectures, batch practicals, faculty and rooms as printed in ${sourceLabel}. Save it to read with no signal, or add it to your Home Screen.`,
    }),
    // The per-batch manifest: its `id`, `name` and `start_url` are what make
    // the installed app "Division O", not "Campus+".
    manifest: batch ? batch.manifestUrl : undefined,
    // iOS ignores the manifest for its home-screen entry but honours these
    // three, so a Saved shortcut gets the batch's own label and no browser
    // chrome. `black-translucent` keeps the night palette under the status bar.
    appleWebApp: {
      capable: true,
      title: batch ? batchShortName(batch.division) : 'Timetable',
      statusBarStyle: 'black-translucent',
    },
  };
}

export default async function DivisionTimetablePage({ params, searchParams }) {
  const { division } = await params;
  const timetable = getDivisionTimetable(division);
  if (!timetable) notFound();

  const query = (await searchParams) || {};
  // An explicit ?day= is a deliberate (and shareable) choice; otherwise the
  // page opens on the institute's real weekday — or, at the weekend, on
  // Monday as a preview. The fallback happens here, on the server, so the
  // first paint already shows the timetable instead of flashing an empty
  // weekend and swapping after hydration. A day that does not exist in the
  // source is ignored here and stripped from the address bar after hydration,
  // so a stale link cannot keep lying about which day is on screen.
  const requestedDay = normalizeTimetableDay(query.day);

  const now = new Date();
  const campus = getCampusTime(now);
  // Schedule-aware, not midnight-aware: the page opens on today until today's
  // *last* lecture has ended, then on the next day that has classes (Monday
  // after Friday, Monday at the weekend). The switch time is read from this
  // division's own events, so a timetable edit moves it automatically, and the
  // decision is made here on the server so the first paint is already right —
  // no flash of a finished day while the browser catches up.
  const auto = resolveAutoDay({
    days: timetable.days,
    weekday: campus.weekday,
    nowMinutes: campus.minutesOfDay,
  });
  const initialDay = requestedDay ?? auto.day;
  // Naming the automatic day in the URL is not a preference: the page keeps
  // following the schedule (and can roll into the weekend) until a different
  // day is chosen explicitly.
  const initialPinned = Boolean(requestedDay && requestedDay !== auto.day);

  // Only what the live view and the offline copy need: the week grid keeps its
  // slots server-side, the snapshot carries the same events the page renders.
  const liveDays = timetable.days.map(({ day, events, freeRanges }) => ({ day, events, freeRanges }));
  const { previous, next } = adjacentDivisions(timetable.division);
  const batch = describeBatch(timetable.division);

  return (
    <main className="mt-10">
      <nav aria-label="Breadcrumb" className="text-[0.8125rem]">
        <a href={ROUTES.timetable} className="inline-flex items-center gap-1.5 font-medium text-muted hover:text-ink">
          <Icon name="chevronLeft" size={14} aria-hidden="true" />
          All divisions
        </a>
      </nav>

      <TimetableOfflineProvider division={timetable.division}>
        {timetable.specialWeek ? (
          <Notice tone="warning" icon="calendar" className="mt-6 max-w-3xl">
            <p className="font-semibold">Special timetable week — {timetable.weekLabel}</p>
            <p className="mt-1">
              This page shows the published special timetable for these dates, not the master timetable.
              Tuesday and Thursday are unchanged.
            </p>
          </Notice>
        ) : null}

        <TimetableLive
          division={timetable.division}
          label={timetable.label}
          friendly={timetable.friendly}
          days={liveDays}
          subjects={timetable.subjects}
          initialDay={initialDay}
          initialPinned={initialPinned}
          initialNow={now.toISOString()}
          offlineSlot={batch ? <TimetableOfflinePill /> : null}
        >
          {timetable.flagged.length ? (
            <div className="mt-8">
              <FlaggedNotice flagged={timetable.flagged} />
            </div>
          ) : null}

          {batch ? <TimetableInstallCard /> : null}

          <details className="tt-week">
            <summary>See the full week at a glance</summary>
            <div className="tt-week__body">
              <WeekTable days={timetable.days} division={timetable.division} />
            </div>
          </details>
        </TimetableLive>

        {batch ? <TimetableInstallSheet /> : null}
      </TimetableOfflineProvider>

      <nav aria-label="Neighbouring divisions" className="mt-10 flex flex-wrap items-center justify-between gap-3">
        {previous ? (
          <a
            href={divisionTimetableHref(previous)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-line px-3.5 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-line-strong hover:no-underline"
          >
            <Icon name="chevronLeft" size={14} aria-hidden="true" />
            Division {previous}
          </a>
        ) : (
          <span />
        )}
        <a href={ROUTES.timetable} className="text-[0.8125rem] font-medium text-muted underline hover:text-ink">
          All divisions A–R
        </a>
        {next ? (
          <a
            href={divisionTimetableHref(next)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-line px-3.5 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-line-strong hover:no-underline"
          >
            Division {next}
            <Icon name="chevronRight" size={14} aria-hidden="true" />
          </a>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
