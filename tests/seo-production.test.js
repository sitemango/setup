import { describe, expect, it } from 'vitest';
import { clubMetadata, eventMetadata, eventDate, eventSchema, clubSchema, breadcrumbs, serializeJsonLd, absoluteUrl, SOCIAL_IMAGE } from '@/lib/seo';
import robots from '@/app/robots';
import nextConfig from '../next.config.mjs';
import JsonLd from '@/components/seo/JsonLd';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isPublicPath } from '../proxy';

const id = '15fe0000-0000-4000-a000-000000000001';
const club = { kind: 'club', status: 'published', visibility: 'public', name: 'Coding Club', slug: 'coding-club', club_category: 'Technical', organization_type: 'technical_club', description: 'Students learn coding together.' };
const event = { id, status: 'published', title: 'Robotics Workshop', description: 'Build a robot.', starts_on: '2026-11-20', start_time: '10:30:00', ends_on: '2026-11-20', end_time: '12:00:00', location: 'Room 1' };

describe('production SEO', () => {
  it('builds distinct club metadata with public slugs, data and share image', () => {
    const first = clubMetadata(club);
    const second = clubMetadata({ ...club, name: 'Art Club', slug: 'art-club', description: 'Art workshops.' });
    expect(first.title).not.toBe(second.title);
    expect(first.description).toContain('Students learn coding together.');
    expect(first.alternates.canonical).toBe('/c/coding-club');
    expect(first.openGraph.url).toBe('https://pccoe.in/c/coding-club');
    expect(first.openGraph.images[0].url).toBe('https://pccoe.in/api/public/club-image/coding-club');
    expect(SOCIAL_IMAGE).toContain('/timetable/social-preview.png');
    expect(first.twitter.card).toBe('summary_large_image');
    expect(isPublicPath('/timetable/social-preview.png')).toBe(true);
  });
  it('uses real event details and India time without fabricating missing fields', () => {
    const metadata = eventMetadata(event, club);
    expect(metadata.title).toContain(event.title);
    expect(metadata.description).toContain('2026-11-20');
    expect(metadata.description).toContain('Room 1');
    expect(metadata.alternates.canonical).toBe(`/campus/events/${id}`);
    expect(eventMetadata({ ...event, title: 'Another event' }, null).title).not.toBe(metadata.title);
    expect(eventDate('2026-11-20', '10:30:00')).toBe('2026-11-20T10:30:00+05:30');
    expect(eventDate('2026-11-20', null)).toBe('2026-11-20');
    expect(eventDate('2026-02-30', null)).toBeUndefined();
    const schema = eventSchema(event, club);
    expect(schema.startDate).toBe('2026-11-20T10:30:00+05:30');
    expect(schema.endDate).toBe('2026-11-20T12:00:00+05:30');
    expect(schema.location.name).toBe('Room 1');
    expect(schema.organizer.name).toBe(club.name);
    expect(eventSchema({ ...event, starts_on: null }, null)).toBeNull();
    expect(eventSchema({ ...event, location: null, ends_on: null, end_time: null }, null)).not.toHaveProperty('location');
  });
  it('escapes JSON-LD, avoids invented affiliations, and strips contact links', () => {
    const schema = clubSchema({ ...club, description: '</script><script>alert(1)</script> email me@example.com https://private.example/file' });
    const json = serializeJsonLd(schema);
    expect(json).not.toContain('</script>');
    expect(json).not.toContain('me@example.com');
    expect(json).not.toContain('private.example');
    expect(JSON.parse(json)['@type']).toBe('Organization');
    const html = renderToStaticMarkup(createElement(JsonLd, { value: schema }));
    const body = html.match(/<script[^>]*>([\s\S]*)<\/script>/)[1];
    expect(JSON.parse(body)).toEqual(schema);
    expect(body).not.toContain('</script>');
    expect(schema).not.toHaveProperty('parentOrganization');
    expect(breadcrumbs([['Clubs', '/clubs']]).itemListElement[0].item).toBe('https://pccoe.in/clubs');
    expect(() => absoluteUrl('//other.example')).toThrow();
  });
  it('sets a noindex response header on the exact private dashboard route', async () => {
    const rules = await nextConfig.headers();
    const home = rules.find((rule) => rule.source === '/home');
    expect(home.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
  });
  it('allows public discovery, restricts management, and never blocks assets', () => {
    const config = robots();
    expect(config.sitemap).toBe('https://pccoe.in/sitemap.xml');
    expect(config.rules[0].allow).toContain('/c/');
    expect(config.rules[0].disallow).toContain('/clubs/*/manage');
    expect(config.rules[0].disallow).toContain('/admin');
    expect(config.rules[0].disallow).not.toContain('/home');
    expect(config.rules[0].disallow).toContain('/home-preview');
    expect(config.rules[0].disallow).not.toContain('/login');
    expect(config.rules[0].disallow).not.toContain('/timetable');
    expect(config.rules[0].disallow).not.toContain('/_next');
  });
});
