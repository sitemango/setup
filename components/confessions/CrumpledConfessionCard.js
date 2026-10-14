'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';
import { ReportDialog } from '@/components/social/ReportDialog';

/** A lightweight crumpled-paper card. Creases are CSS-only so the feed never
 * creates a WebGL context or physics world per confession. */
export function CrumpledConfessionCard({ item, number }) {
  const [open, setOpen] = useState(false);
  return (
    <Card as="article" className={`confession-paper crumpled-page p-5 ${open ? 'is-unfolded' : 'is-crumpled'}`}>
      <span className="paper-crease paper-crease-a" aria-hidden="true" />
      <span className="paper-crease paper-crease-b" aria-hidden="true" />
      <span className="paper-crease paper-crease-c" aria-hidden="true" />
      <button
        type="button"
        className="crumple-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? '×' : '+'}</span>
        <span className="sr-only">{open ? 'Crumple confession' : 'Unfold confession'}</span>
      </button>
      <div className="crumpled-content">
        <p className="whitespace-pre-wrap leading-relaxed">{item.content}</p>
        <footer className="mt-5 flex items-center justify-between text-2xs text-muted">
          <time dateTime={item.published_at}>Anonymous note #{number}</time>
          <ReportDialog targetType="confession" targetRef={item.id} label="confession" />
        </footer>
      </div>
      {!open ? <span className="crumpled-label" aria-hidden="true">Unfold</span> : null}
    </Card>
  );
}
