import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketPlaceholder } from '@/components/marketplace/MarketPlaceholder';

const read = (path) => readFileSync(path, 'utf8');

describe('campus discovery refresh', () => {
  it('puts browsing before compact club cards without changing club data access', () => {
    const page = read('app/(shell)/(app)/explore/page.js');
    expect(page.indexOf('aria-label="Browse campus"')).toBeLessThan(page.indexOf('<CampusDiscovery clubs='));
    expect(page).toContain('await requireUser()');
    expect(page).toContain('listPublicClubs');
    expect(read('app/styles/sections.css')).toContain('.explore-clubs-grid .club-card');
  });
  it('uses authorized listing covers when enabled and an honest placeholder otherwise', () => {
    const page = read('app/(shell)/(app)/market/page.js');
    expect(page).toContain('className="market-grid"');
    expect(page).toContain('CAMPUS_MARKET_ATTACHMENTS_ENABLED');
    expect(page).toContain('CAMPUS_STORAGE_V3_ENABLED');
    expect(page).toContain('<MarketplaceGallery listingId={listing.id} coverOnly />');
    expect(page).toContain('<MarketPlaceholder />');
    const placeholder = renderToStaticMarkup(React.createElement(MarketPlaceholder));
    expect(placeholder).toContain('No photo provided');
    expect(placeholder).toContain('<svg');
    expect(placeholder).not.toContain('<img');
    const gallery = read('components/marketplace/MarketplaceGallery.js');
    expect(gallery).toContain('onError={()=>setCoverFailed(true)}');
    expect(gallery).toContain('/api/storage/marketplace/');
  });
  it('routes each permitted create shortcut to the same Home composer', () => {
    const frame = read('components/layout/AuthenticatedAppFrame.js');
    for (const kind of ['post', 'poll', 'discussion']) expect(frame).toContain(`/home?compose=${kind}`);
    expect(read('components/home/HomeComposer.js')).toContain('<PostComposer');
    expect(read('components/posts/PostComposer.js')).toContain('Post what&apos;s happening on campus...');
    expect(read('components/posts/PostComposer.js')).toContain('setKind(requestedKind.kind)');
  });
});
