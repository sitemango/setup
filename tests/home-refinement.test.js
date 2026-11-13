import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeRail } from '@/components/home/HomeRail';
import { HomeFeatureTiles } from '@/components/home/HomeFeatureTiles';

describe('home dashboard refinement', () => {
  it('retains six labelled destinations in the quick navigation', () => {
    const html = renderToStaticMarkup(React.createElement(HomeFeatureTiles, { division: null }));
    for (const name of ['Noticeboard', 'Events', 'Timetable', 'Clubs', 'Market', 'Gigs']) {
      expect(html).toContain(`aria-label="${name}"`);
      expect(html).toContain(`>${name}</span>`);
    }
  });

  it('renders only provided rail entries and their real engagement', () => {
    const empty = renderToStaticMarkup(React.createElement(HomeRail));
    expect(empty).not.toContain('Busiest right now');
    expect(empty).not.toContain('Noticeboard');
    expect(empty).not.toContain('Next on campus');
    const html = renderToStaticMarkup(React.createElement(HomeRail, {
      trending: [{ id: 'post-1', title: 'Actual campus discussion', score: 7, reaction_count: 4, comment_count: 3 }],
      notices: [{ id: 'notice-1', title: 'Library hours', category: 'Library', published_at: '2026-01-01T00:00:00Z' }],
      events: [{ id: 'event-1', title: 'Club meeting', starts_on: '2026-01-02', start_time: '10:00' }],
    }));
    expect(html).toContain('Actual campus discussion');
    expect(html).toContain('Library hours');
    expect(html).toContain('Club meeting');
    expect(html).toContain('title="reactions">4');
    expect(html).toContain('title="comments">3');
    expect(html.indexOf('Noticeboard')).toBeLessThan(html.indexOf('Busiest right now'));
    expect(html.indexOf('Busiest right now')).toBeLessThan(html.indexOf('Next on campus'));
    expect(html).not.toContain('Campus update #2');
  });
});
