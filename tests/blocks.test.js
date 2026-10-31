import { describe, expect, it, vi } from 'vitest';
import { listBlockedUsers } from '@/lib/blocks';

describe('blocked-profile reads', () => {
  it('maps the embedded profile rather than exposing the block row as a profile', async () => {
    const createdAt = '2026-10-31T03:00:00.000Z';
    const limit = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'block-row-id',
          created_at: createdAt,
          blocked: { id: 'profile-id', username: 'blocked_student', display_name: 'Blocked Student' },
        },
        { id: 'invisible-block-row', created_at: createdAt, blocked: null },
      ],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    const result = await listBlockedUsers({ from }, 'viewer-profile-id');

    expect(from).toHaveBeenCalledWith('blocks');
    expect(select).toHaveBeenCalledWith('id, created_at, blocked:profiles!blocks_blocked_id_fkey ( id, username, display_name )');
    expect(eq).toHaveBeenCalledWith('blocker_id', 'viewer-profile-id');
    expect(result).toEqual([{
      id: 'profile-id',
      username: 'blocked_student',
      display_name: 'Blocked Student',
      created_at: createdAt,
    }]);
    expect(result[0].id).not.toBe('block-row-id');
  });
});
