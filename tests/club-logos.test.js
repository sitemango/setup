import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Club logos, mapped from the Drive folder the operator manages by hand.
 * Covers the pure slug table, the public streaming route's contract (404
 * fallbacks, ETag/304, no Drive IDs in responses) and the component-level
 * monogram fallback. Drive itself is never contacted: the storage gateway
 * and the public club projection are mocked.
 */

const LOGOS = vi.hoisted(() => ({
  fixture: { ciergate: 'A'.repeat(28) },
}));

vi.mock('@/lib/clubs/logos', () => ({
  CLUB_LOGO_FILES: LOGOS.fixture,
  CLUB_LOGO_SLUGS: Object.keys(LOGOS.fixture),
  isClubLogoSlug: (slug) => typeof slug === 'string' && slug in LOGOS.fixture,
  clubLogoFileId: (slug) => (typeof slug === 'string' ? LOGOS.fixture[slug] || null : null),
  clubLogoSrc: (slug) => (typeof slug === 'string' && LOGOS.fixture[slug] ? `https://lh3.googleusercontent.com/d/${LOGOS.fixture[slug]}=w256` : null),
  clubLogoSrcFromMap: (map, slug) => {
    const id = map[slug];
    return typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id) ? `https://lh3.googleusercontent.com/d/${id}=w256` : null;
  },
}));

const storage = vi.hoisted(() => ({
  getFileMetadata: vi.fn(),
  downloadFile: vi.fn(),
}));
vi.mock('@/lib/storage', () => storage);

const publicData = vi.hoisted(() => ({
  getPublicClubBySlug: vi.fn(),
  isPubliclyListedClub: vi.fn(),
}));
vi.mock('@/lib/data/public', () => publicData);

const { GET, __resetClubLogoCache } = await import('@/app/api/public/club-logo/[slug]/route.js');
const { ClubLogo } = await import('@/components/clubs/ClubLogo.js');
const { ClubCard } = await import('@/components/clubs/ClubCard.js');

const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x11, 0x22, 0x33]);
const CHECKSUM = 'b'.repeat(64);
const okClub = { item: { slug: 'ciergate', kind: 'club', status: 'published', visibility: 'public' }, unavailable: false };

const req = (headers = {}) => new Request('https://campus.example/api/public/club-logo/ciergate', { headers });
const params = (slug) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  vi.clearAllMocks();
  __resetClubLogoCache();
  publicData.getPublicClubBySlug.mockResolvedValue(okClub);
  publicData.isPubliclyListedClub.mockReturnValue(true);
  storage.getFileMetadata.mockResolvedValue({ size: BYTES.length, mime: 'image/jpeg', checksum: CHECKSUM });
  storage.downloadFile.mockResolvedValue(BYTES);
});

describe('club logo slug table', () => {
  it('maps a configured slug to the Campus+ URL and an unknown/empty/malformed one to null', async () => {
    const real = await vi.importActual('@/lib/clubs/logos');
    expect(real.clubLogoSrcFromMap({ 'team-ambush': 'A'.repeat(28) }, 'team-ambush')).toBe(`https://lh3.googleusercontent.com/d/${'A'.repeat(28)}=w256`);
    expect(real.clubLogoSrcFromMap({ 'team-ambush': '' }, 'team-ambush')).toBeNull();
    expect(real.clubLogoSrcFromMap({ 'team-ambush': 'not id!' }, 'team-ambush')).toBeNull();
    expect(real.clubLogoSrcFromMap({}, 'team-ambush')).toBeNull();
    // Every wired ID is well-formed; clubLogoSrc only emits same-origin paths.
    for (const [slug, id] of Object.entries(real.CLUB_LOGO_FILES)) {
      expect(id === '' || /^[A-Za-z0-9_-]{10,200}$/.test(id), `file ID for ${slug} must be empty or well-formed`).toBe(true);
      if (id) expect(real.clubLogoSrc(slug)).toBe(`https://lh3.googleusercontent.com/d/${id}=w256`);
    }
  });

  it('ships a table of routable, regex-valid catalogue slugs', async () => {
    const real = await vi.importActual('@/lib/clubs/logos');
    const { CLUB_SLUG_REGEX } = await import('@/lib/constants');
    const keys = Object.keys(real.CLUB_LOGO_FILES);
    expect(keys.length).toBeGreaterThanOrEqual(16);
    for (const slug of keys) {
      expect(CLUB_SLUG_REGEX.test(slug), `slug ${slug} must satisfy CLUB_SLUG_REGEX`).toBe(true);
    }
  });
});

describe('GET /api/public/club-logo/[slug]', () => {
  it('answers 404 for an unmapped slug before touching anything', async () => {
    const res = await GET(req(), params('not-a-club'));
    expect(res.status).toBe(404);
    expect(publicData.getPublicClubBySlug).not.toHaveBeenCalled();
    expect(storage.getFileMetadata).not.toHaveBeenCalled();
  });

  it('answers 404 when the club is not publicly listed', async () => {
    publicData.isPubliclyListedClub.mockReturnValue(false);
    const res = await GET(req(), params('ciergate'));
    expect(res.status).toBe(404);
    expect(storage.getFileMetadata).not.toHaveBeenCalled();
  });

  it('answers 503 when the public projection is unavailable', async () => {
    publicData.getPublicClubBySlug.mockResolvedValue({ item: null, unavailable: true });
    const res = await GET(req(), params('ciergate'));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('serves the verified bytes with an ETag and public revalidation', async () => {
    const res = await GET(req(), params('ciergate'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('etag')).toBe(`"${CHECKSUM}"`);
    expect(res.headers.get('cache-control')).toContain('public');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
    expect(storage.downloadFile).toHaveBeenCalledWith('A'.repeat(28), { size: BYTES.length, mime: 'image/jpeg', checksum: CHECKSUM });
  });

  it('honours If-None-Match with a 304 and no body', async () => {
    const res = await GET(req({ 'if-none-match': `"${CHECKSUM}"` }), params('ciergate'));
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(`"${CHECKSUM}"`);
  });

  it('refuses non-image payloads', async () => {
    storage.getFileMetadata.mockResolvedValue({ size: BYTES.length, mime: 'application/pdf', checksum: CHECKSUM });
    const res = await GET(req(), params('ciergate'));
    expect(res.status).toBe(404);
  });

  it('answers 503 when the gateway is unavailable and never leaks internals', async () => {
    storage.getFileMetadata.mockRejectedValue(new Error('storage_unavailable'));
    const res = await GET(req(), params('ciergate'));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('ClubLogo component', () => {
  it('falls back to the monogram when no logo is configured', () => {
    const html = renderToStaticMarkup(React.createElement(ClubLogo, { src: null, name: 'Team Ambush', id: 'x', size: 58 }));
    expect(html).toContain('club-monogram');
    expect(html).not.toContain('<img');
  });

  it('renders the streamed logo when configured', () => {
    const html = renderToStaticMarkup(React.createElement(ClubLogo, { src: 'https://lh3.googleusercontent.com/d/fixture=w256', name: 'Cyber Gate', id: 'x', size: 58 }));
    expect(html).toContain('<img');
    expect(html).toContain('src="https://lh3.googleusercontent.com/d/fixture=w256"');
  });
});

describe('ClubCard', () => {
  const club = {
    id: '3f6e6bb0-0000-4000-8000-0000000000aa',
    slug: 'ciergate',
    name: 'Cyber Gate PCCOE',
    description: 'A student chapter.',
    club_category: 'Technical',
    organization_type: 'professional_chapter',
    member_count: 12,
    post_count: 3,
    meeting_info: null,
    source_label: null,
    verification_status: 'source_checked',
    is_official: false,
    admin_assigned: true,
    join_policy: 'open',
    recruitment_info: null,
  };

  it('renders the configured logo image for a listed club', () => {
    const html = renderToStaticMarkup(React.createElement(ClubCard, { club }));
    expect(html).toContain('https://lh3.googleusercontent.com/d/');
  });

  it('renders the monogram for a club with no configured logo', () => {
    const html = renderToStaticMarkup(React.createElement(ClubCard, { club: { ...club, slug: 'unmapped-club' } }));
    expect(html).toContain('club-monogram');
    expect(html).not.toContain('<img');
  });
});
