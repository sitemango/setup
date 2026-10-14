import { PageHeader } from '@/components/ui';
import { ConfessionsExperience } from '@/components/confessions/ConfessionsExperience';
import { getConfessions, getConfessionQuota } from '@/lib/data/confessions';

export const metadata={title:'Random Confessions'};
export default async function ConfessionsPage(){const [{items,nextCursor,unavailable},quota]=await Promise.all([getConfessions(),getConfessionQuota()]);return <div className="mx-auto max-w-3xl"><PageHeader eyebrow="Anonymous · asynchronous" title="Random Confessions" description="A quiet place to leave a thought. Every submission is reviewed before it joins the feed."/>{unavailable?<p className="mb-4 rounded-xl border border-line p-4 text-sm text-muted">The confession feed is temporarily unavailable.</p>:null}<ConfessionsExperience initialItems={items} initialCursor={nextCursor} quota={quota}/></div>}
