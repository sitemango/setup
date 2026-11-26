import { describe, expect, it } from 'vitest';
import { metadata as homeMetadata } from '@/app/page';
import { metadata as timetableMetadata } from '@/app/timetable/page';
import { generateMetadata } from '@/app/timetable/[division]/page';
import { DIVISIONS } from '@/lib/constants';

describe('homepage and timetable public metadata', () => {
  it('indexes canonical public landing pages with social previews', () => {
    for (const [meta, canonical] of [[homeMetadata, '/'], [timetableMetadata, '/timetable']]) {
      expect(meta.robots.index).toBe(true);
      expect(meta.alternates.canonical).toBe(canonical);
      expect(meta.openGraph.images[0].url).toMatch(/^https:\/\/pccoe\.in\//);
      expect(meta.twitter.card).toBe('summary_large_image');
    }
  });
  it('has unique titles and canonical lowercase URLs for every division', async () => {
    const titles = new Set();
    for (const division of DIVISIONS) {
      const meta = await generateMetadata({ params: Promise.resolve({ division }) });
      expect(meta.robots.index).toBe(true);
      expect(meta.alternates.canonical).toBe(`/timetable/${division.toLowerCase()}`);
      expect(meta.manifest).toBeTruthy();
      titles.add(meta.title);
    }
    expect(titles.size).toBe(DIVISIONS.length);
  });
});
