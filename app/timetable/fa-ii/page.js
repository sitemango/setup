import { getCurrentUser } from '@/lib/auth/session';
import { faIIPreselection } from '@/lib/timetable/fa-ii-2026-27-sem1';
import FaIISchedule from '@/components/timetable/FaIISchedule';

export const metadata = { title: 'FA-II Timetable', description: 'First-year Formative Assessment-II schedule, Sem-I 2026–27.' };
export const dynamic = 'force-dynamic';

export default async function FaIIPage() {
  const user = await getCurrentUser();
  const initialSelection = user?.accountType === 'student' ? faIIPreselection(user.profile?.branch) : null;
  return (
    <main className="mt-10">
      <header className="max-w-3xl">
        <p className="t-label">Notice · 19 November 2026</p>
        <h1 className="t-display mt-2">Formative Assessment-II Schedule</h1>
        <p className="t-secondary mt-3 leading-relaxed">Pimpri Chinchwad Education Trust — Pimpri Chinchwad College of Engineering (PCCOE)<br />Sector No.26, Pradhikaran, Nigdi, Pune-411044<br />Department: AS &amp; H</p>
        <p className="mt-3 font-semibold">F.Y.B.Tech. Students · Sem-I · Academic year 2026-27</p>
        <p className="t-secondary mt-3 leading-relaxed">All the F.Y.B.Tech. Students are hereby informed to note the schedule for Formative Assessment-II (FA-II) of Sem-I A.Y. 2026-27 for the following courses.</p>
      </header>
      <FaIISchedule initialSelection={initialSelection} />
      <section className="mt-10 text-sm text-muted" aria-label="Notice signatories">
        <h2 className="font-semibold text-ink">Signatories</h2>
        <ul className="mt-2 space-y-1"><li>Mr Sanjay Mapari — FA Coordinator</li><li>Ms Vithika Sidhabhatti — FA Coordinator</li><li>Mr Dattatray Anarse — Dept. Exam Coordinator</li><li>Dr. Leena Sharma — HoD, AS &amp; H</li></ul>
      </section>
    </main>
  );
}
