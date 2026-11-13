'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { ShellHeader } from '@/components/layout/ShellHeader';

// One visibility state controls the rail and the header toggle on every route.
export function ShellFrame({ children, ...props }) {
  const [open, setOpen] = useState(true);
  const [mobile, setMobile] = useState(false);
  const frameRef = useRef(null);
  const contentRef = useRef(null);
  const pathname = usePathname();

  useEffect(() => {
    const content = contentRef.current;
    if (!content || !window.matchMedia('(min-width: 768px) and (prefers-reduced-motion: no-preference)').matches) return undefined;
    const animation = content.animate(
      [{ opacity: 0.92, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 220, easing: 'ease-out' },
    );
    return () => animation.cancel();
  }, [pathname]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const sync = () => {
      setMobile(media.matches);
      setOpen(!media.matches);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!mobile || !open) return undefined;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const sidebar = frameRef.current?.querySelector('#app-sidebar');
    sidebar?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        // Let a nested, portalled Create menu handle its own Escape first.
        if (sidebar?.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')) return;
        event.preventDefault();
        setOpen(false);
        Array.from(frameRef.current?.querySelectorAll('.sidebar-toggle') || []).find((button) => button.getClientRects().length)?.focus();
      } else if (event.key === 'Tab' && sidebar?.contains(document.activeElement)) {
        const items = [...sidebar.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter((item) => item.getClientRects().length);
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === sidebar)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobile, open]);

  return (
    <div className="app-frame" data-sidebar-open={open} ref={frameRef}>
      {mobile && open ? <div className="sidebar-backdrop" onClick={() => { setOpen(false); Array.from(frameRef.current?.querySelectorAll('.sidebar-toggle') || []).find((button) => button.getClientRects().length)?.focus(); }} aria-hidden="true" /> : null}
      <div className="sidebar-host" hidden={!open}>
        <Sidebar {...props} mobile={mobile} onClose={() => { setOpen(false); Array.from(frameRef.current?.querySelectorAll('.sidebar-toggle') || []).find((button) => button.getClientRects().length)?.focus(); }} onNavigate={() => { if (mobile) setOpen(false); }} />
      </div>
      <div className="shell-root">
        <ShellHeader {...props} sidebarOpen={open} onToggleSidebar={() => setOpen((value) => !value)} />
        <main ref={contentRef} id="content" className="shell-content shell-main mx-auto w-full px-4 pb-28 pt-4 sm:px-6 lg:pb-16 lg:pt-5">
          {children}
        </main>
      </div>
    </div>
  );
}
