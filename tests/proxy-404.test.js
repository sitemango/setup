import { afterEach, describe, expect, it, vi } from 'vitest';

const claims = vi.hoisted(() => ({ signedIn: false }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: claims.signedIn ? { sub: 'user' } : null } }) } }),
}));
vi.mock('next/server', () => ({
  NextResponse: {
    next: () => ({ kind: 'next', cookies: { set() {} } }),
    redirect: (url) => ({ kind: 'redirect', url: url.toString(), headers: new Headers() }),
  },
}));
const { proxy } = await import('../proxy.js');

function request(path) {
  const url = new URL(path, 'https://campus.example');
  return { url: url.toString(), nextUrl: url, headers: new Headers(), cookies: { getAll: () => [] } };
}

describe('proxy 404 and authentication routing', () => {
  afterEach(() => { vi.unstubAllEnvs(); claims.signedIn = false; });
  it.each([false, true])('lets unknown paths reach Next with signedIn=%s', async (signedIn) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
    claims.signedIn = signedIn;
    for (const path of ['/unknown', '/home/unknown', '/clubs/id/manage/unknown']) {
      expect((await proxy(request(path))).kind).toBe('next');
    }
  });
  it('continues to redirect signed-out visitors from protected static and dynamic pages', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
    for (const path of ['/home', '/post/bad', '/clubs/new', '/clubs/id/manage', '/campus/events/new', '/explore/resources/id']) {
      const result = await proxy(request(path));
      expect(result.kind, path).toBe('redirect');
      expect(new URL(result.url).pathname).toBe('/login');
      expect(new URL(result.url).searchParams.get('next')).toBe(path);
    }
  });
  it.each(['Mozilla/5.0', 'Googlebot'])('keeps home protected for %s while preserving the sign-in return path', async (userAgent) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
    const home = request('/home?view=feed');
    home.headers.set('user-agent', userAgent);
    const guest = await proxy(home);
    expect(guest.kind).toBe('redirect');
    expect(new URL(guest.url).pathname).toBe('/login');
    expect(new URL(guest.url).searchParams.get('next')).toBe('/home?view=feed');
    claims.signedIn = true;
    expect((await proxy(home)).kind).toBe('next');
  });
  it('redirects authenticated entry requests to home and leaves guest entry pages accessible', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
    for (const path of ['/', '/login']) expect((await proxy(request(path))).kind).toBe('next');
    claims.signedIn = true;
    for (const path of ['/', '/login']) {
      const result = await proxy(request(path));
      expect(result.kind).toBe('redirect');
      expect(new URL(result.url).pathname).toBe('/home');
      expect(result.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    }
  });
  it('preserves public dynamic pages and legacy redirects', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
    for (const path of ['/c/bad', '/campus/events/bad', '/clubs/bad', '/timetable/invalid']) expect((await proxy(request(path))).kind).toBe('next');
    const result = await proxy(request('/explore/team-finder?q=1'));
    expect(result.kind).toBe('redirect');
    expect(new URL(result.url).pathname).toBe('/campus/teams');
    expect(new URL(result.url).search).toBe('?q=1');
  });
});
