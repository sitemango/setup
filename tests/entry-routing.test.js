import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ user: null }));
vi.mock('@/lib/auth/session', () => ({ getCurrentUser: async () => session.user }));
vi.mock('next/navigation', () => ({ redirect: (path) => { throw new Error(`redirect:${path}`); } }));
vi.mock('@/app/login/page', () => ({ default: () => null }));
vi.mock('@/app/login/layout', () => ({ default: ({ children }) => children }));
const { default: RootPage, dynamic, metadata } = await import('@/app/page');

describe('session-aware root entry', () => {
  beforeEach(() => { session.user = null; });
  it('renders the same login page and site schema for guests', async () => {
    const searchParams = Promise.resolve({ next: '/timetable', error: 'provider' });
    const tree = await RootPage({ searchParams });
    const [jsonLd, loginPage] = tree.props.children;
    expect(jsonLd.props.value['@type']).toBe('WebSite');
    expect(loginPage.props.searchParams).toBe(searchParams);
    expect(dynamic).toBe('force-dynamic');
    expect(metadata.robots.index).toBe(true);
    expect(metadata.alternates.canonical).toBe('/');
  });
  it.each([{ profile: {} }, { needsProfileSetup: true }, { accountType: 'visitor' }])('sends any authenticated account through the home gate: %o', async (user) => {
    session.user = user;
    await expect(RootPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/home');
  });
});
