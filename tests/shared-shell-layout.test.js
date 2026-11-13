import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(file, 'utf8');

describe('shared application shell route boundary', () => {
  it('keeps app, public discovery and map below the same optional frame', () => {
    expect(read('app/(shell)/layout.js')).toContain('<OptionalAppFrame>{children}</OptionalAppFrame>');
    for (const route of ['(app)', '(public)', 'map']) {
      expect(existsSync(`app/(shell)/${route}/layout.js`)).toBe(true);
      expect(read(`app/(shell)/${route}/layout.js`)).not.toContain('<OptionalAppFrame>');
    }
  });

  it('preserves the protected account gate and the static offline boundary', () => {
    expect(read('app/(shell)/(app)/layout.js')).toContain('await requireUser()');
    expect(read('app/timetable/offline/page.js')).toContain("dynamic = 'force-static'");
    expect(existsSync('app/(shell)/timetable/offline/page.js')).toBe(false);
  });
});

describe('shared sidebar layout ownership', () => {
  it('shows the sidebar toggle only in the desktop header and keeps the mobile menu', () => {
    const header = read('components/layout/ShellHeader.js');
    const mobile = header.slice(header.indexOf('{/* Mobile */}'), header.indexOf('{/* Desktop */}'));
    const desktop = header.slice(header.indexOf('{/* Desktop */}'));
    expect(mobile).not.toContain('{sidebarToggle}');
    expect(mobile).toContain('<MobileMenu');
    expect(desktop).toContain('{sidebarToggle}');
    const menu = read('components/layout/MobileMenu.js');
    expect(menu).toContain('getTimetableHref(user?.division)');
    expect(menu).toContain('ROUTES.map');
    expect(menu).toContain('createItems.map');
  });

  it('keeps desktop shell spacing controlled by the sidebar state, not route material sheets', () => {
    const css = read('app/styles/shell-frame.css');
    expect(css).toMatch(/:root \.app-frame \.shell-root\s*\{\s*padding-left:\s*0/);
    expect(css).toMatch(/data-sidebar-open='true'\] \.shell-root\s*\{\s*padding-left:\s*17rem/);
    for (const sheet of ['app/styles/lumen.css', 'app/styles/aurora.css']) {
      expect(read(sheet)).not.toMatch(/:root \.shell-root\s*\{[^}]*padding-left/s);
    }
  });
});
