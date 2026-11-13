import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HomeComposer } from '@/components/home/HomeComposer';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/posts/PostComposer', () => ({ PostComposer: ({ defaultKind }) => React.createElement('div', { 'data-testid': 'editor' }, `Editor: ${defaultKind}`) }));

describe('Home composer default', () => {
  it('renders the post editor immediately for permitted users', () => {
    const html = renderToStaticMarkup(React.createElement(HomeComposer, { canPost: true, authorName: 'Alex' }));
    expect(html).toContain('New on campus');
    expect(html).toContain('Posts, discussions and polls');
    expect(html).toContain('data-testid="editor">Editor: post');
    expect(html).not.toContain('home-composer__open');
  });

  it('still prevents posting when the account is not permitted', () => {
    const html = renderToStaticMarkup(React.createElement(HomeComposer, { canPost: false }));
    expect(html).toContain('Your account cannot publish posts right now.');
    expect(html).not.toContain('data-testid="editor"');
  });
});
