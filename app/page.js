import Link from 'next/link';
import { BrandLockup } from '@/components/brand/Brand';
import JsonLd from '@/components/seo/JsonLd';
import { publicMetadata, SITE_URL } from '@/lib/seo';

export const metadata = publicMetadata({
  title: 'Campus+ | PCCOE Student Community and Timetables',
  description: 'Explore first-year PCCOE timetables, student clubs and campus events on Campus+, an independent student-built platform.',
  canonical: '/',
  imageAlt: 'Campus+ student platform',
});

export default function RootPage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
      <JsonLd value={{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Campus+', url: SITE_URL, description: 'An independent student-built platform for campus life at PCCOE.' }} />
      <header>
        <BrandLockup />
        <p className="t-label mt-12">Independent student project</p>
        <h1 className="t-display mt-3">Campus life, in one place</h1>
        <p className="t-secondary mt-4 max-w-2xl leading-relaxed">Campus+ is a student-built space for PCCOE students. Find first-year class timetables, explore student organizations and discover published campus events.</p>
        <div className="mt-6 flex flex-wrap gap-4">
          <Link className="font-semibold underline" href="/login">Sign in to Campus+</Link>
          <Link className="font-semibold underline" href="/home">Open Campus+</Link>
        </div>
      </header>
      <nav aria-label="Explore Campus+" className="mt-12 grid gap-5 sm:grid-cols-3">
        <Link className="card card-interactive p-5" href="/timetable"><h2 className="t-section">Class timetables</h2><p className="t-secondary mt-2">Browse first-year divisions A–R, with lectures, practicals and rooms.</p></Link>
        <Link className="card card-interactive p-5" href="/clubs"><h2 className="t-section">Student clubs</h2><p className="t-secondary mt-2">Explore the public directory of clubs and student organizations.</p></Link>
        <Link className="card card-interactive p-5" href="/campus/events"><h2 className="t-section">Campus events</h2><p className="t-secondary mt-2">Find published events and their available details.</p></Link>
      </nav>
      <footer className="mt-14 max-w-2xl text-sm text-muted leading-relaxed">
        <p>Independent student project — not affiliated with, operated by, or endorsed by PCCOE or PCET.</p>
        <Link className="mt-2 inline-block underline" href="/legal">Legal &amp; Institutional Independence</Link>
      </footer>
    </main>
  );
}
