import { describe, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => ({ clubs: [], events: [] }));
vi.mock('@/lib/data/public', () => ({ listPublicClubs: async ({ offset, limit }) => ({ items: data.clubs.slice(offset, offset + limit) }) }));
vi.mock('@/lib/data/public-cache', () => ({ listPublishedEvents: async ({ offset, limit }) => ({ items: data.events.slice(offset, offset + limit) }) }));
const { default: sitemap } = await import('@/app/sitemap');

describe('sitemap', () => {
  it('includes only public canonical records, de-duplicates and uses real timestamps', async () => {
    const club = { kind: 'club', status: 'published', visibility: 'public', slug: 'coding-club', updated_at: '2026-01-02T00:00:00Z' };
    const event = { id: '15fe0000-0000-4000-a000-000000000001', status: 'published', published_at: '2026-02-02T00:00:00Z' };
    data.clubs = [club, club, { ...club, slug: 'private-club', visibility: 'private' }, { ...club, slug: 'draft-club', status: 'draft' }];
    data.events = [event, { ...event, id: '15fe0000-0000-4000-a000-000000000002', status: 'draft' }];
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain('https://pccoe.in/');
    expect(urls).not.toContain('https://pccoe.in/home');
    expect(urls).not.toContain('https://pccoe.in/login');
    expect(urls).toContain('https://pccoe.in/timetable');
    expect(urls).toContain('https://pccoe.in/timetable/o');
    expect(urls).not.toContain('https://pccoe.in/timetable/O');
    expect(urls).toContain('https://pccoe.in/c/coding-club');
    expect(urls).toContain(`https://pccoe.in/campus/events/${event.id}`);
    expect(urls).not.toContain('https://pccoe.in/c/private-club');
    expect(urls).not.toContain('https://pccoe.in/c/draft-club');
    expect(new Set(urls).size).toBe(urls.length);
    expect(entries.find((entry) => entry.url.endsWith('/c/coding-club')).lastModified).toBe(club.updated_at);
    expect(entries.find((entry) => entry.url.endsWith(event.id)).lastModified).toBe(event.published_at);
  });
  it('reads beyond the first 500 rows', async () => {
    data.events = [];
    data.clubs = Array.from({ length: 501 }, (_, i) => ({ kind: 'club', status: 'published', visibility: 'public', slug: `club-${i}` }));
    const entries = await sitemap();
    expect(entries).toHaveLength(523);
    expect(entries.some((entry) => entry.url.endsWith('/c/club-500'))).toBe(true);
  });
});
