import { getDivisionSummaries, TIMETABLE_SOURCE } from '@/lib/timetable';
import { divisionTimetableHref } from '@/lib/timetable/meta';
import { publicMetadata } from '@/lib/seo';

export const metadata = publicMetadata({
  title: 'PCCOE Class Timetables — Divisions A to R',
  description:
    'First-year class timetables for divisions A–R, Monday to Friday. Department AS & H, Academic Year 2026–2027, SEM-I. No sign-in needed.',
  canonical: '/timetable',
  imageAlt: 'Campus+ class timetables',
});

/**
 * The division selector — public, static, and useful before a student even
 * has an account. Every tile is a real link to that division's timetable;
 * each tile shows its division, short programme label and academic year.
 */
export default function TimetableIndexPage() {
  const divisions = getDivisionSummaries();

  return (
    <main className="mt-10">
      <header className="max-w-3xl">
        <p className="t-label">First year · {TIMETABLE_SOURCE.semester}</p>
        <h1 className="t-display mt-2">Class timetables</h1>
        <p className="t-secondary mt-3 max-w-[68ch] leading-relaxed">
          Pick your division to see its Monday–Friday timetable — lectures, batch-wise practicals, faculty and
          rooms, exactly as printed in the {TIMETABLE_SOURCE.department} timetable for{' '}
          {TIMETABLE_SOURCE.academicYear}. No sign-in needed; the link works for anyone you share it with.
        </p>
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted">
          Signed in to Campus+? Save your division in Settings → Profile and the Timetable menu will open your
          division directly.
        </p>
      </header>

      <nav aria-label="Divisions A to R" className="mt-8">
        <ul className="tt-tiles">
          {divisions.map(({ division, label, year }) => (
            <li key={division}>
              <a
                href={divisionTimetableHref(division)}
                className="card card-interactive tt-tile"
                aria-label={`Division ${division} (${label}) timetable`}
              >
                <span className="tt-tile__letter">{division}</span>
                <span className="tt-tile__branch">{label}</span>
                <span className="tt-tile__friendly">{year}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
