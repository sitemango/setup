import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import LoginPage from '@/app/login/page';
import LoginLayout from '@/app/login/layout';
import JsonLd from '@/components/seo/JsonLd';
import { publicMetadata, SITE_URL } from '@/lib/seo';

export const metadata = publicMetadata({
  title: 'Campus+ | PCCOE Student Community and Timetables',
  description: 'Explore first-year PCCOE timetables, student clubs and campus events on Campus+, an independent student-built platform.',
  canonical: '/',
  imageAlt: 'Campus+ student platform',
});

// The entry varies by session and must never be cached between visitors.
export const dynamic = 'force-dynamic';

export default async function RootPage({ searchParams }) {
  const user = await getCurrentUser();
  // The dashboard's existing gate handles onboarding and account status.
  if (user) redirect('/home');

  return (
    <LoginLayout>
      <JsonLd value={{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Campus+', url: SITE_URL, description: 'An independent student-built platform for campus life at PCCOE.' }} />
      <LoginPage searchParams={searchParams} />
    </LoginLayout>
  );
}
