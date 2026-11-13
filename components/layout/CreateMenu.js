'use client';

/**
 * The single "Create" entry point.
 *
 * It only ever lists destinations the signed-in student is actually allowed to
 * open — the permission checks happen server-side in `app/(app)/layout.js` and
 * arrive here as a plain list, so no authorization logic runs in the browser.
 */

import { Button, Dropdown, MenuLink } from '@/components/ui';

export function CreateMenu({ items = [] }) {
  if (!items.length) return null;

  return (
    <Dropdown
      label="Create"
      align="left"
      className="w-full"
      matchTriggerWidth
      trigger={({ open, toggle }) => (
        <Button
          className="create-menu__trigger"
          variant="primary"
          size="md"
          block
          icon={open ? 'close' : 'plus'}
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          Create
        </Button>
      )}
    >
      {items.map((item) => (
        <MenuLink key={item.href} href={item.href} icon={item.icon}>
          {item.label}
        </MenuLink>
      ))}
    </Dropdown>
  );
}
