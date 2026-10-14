import 'server-only';
import { getServerClient } from '@/lib/supabase/server';

export async function getConfessions({ cursor = null, limit = 12 } = {}) {
  const supabase = await getServerClient();
  if (!supabase) return { items: [], nextCursor: null, unavailable: true };
  const { data, error } = await supabase.rpc('browse_confessions', {
    p_cursor_published_at: cursor?.publishedAt || null,
    p_cursor_id: cursor?.id || null,
    p_limit: limit,
  });
  if (error) return { items: [], nextCursor: null, unavailable: true };
  const items = data || [];
  const last = items.at(-1);
  return { items, nextCursor: items.length === limit && last ? { publishedAt: last.published_at, id: last.id } : null, unavailable: false };
}

export async function getConfessionQuota() {
  const supabase = await getServerClient();
  if (!supabase) return { limit: 2, used: 0, remaining: 2 };
  const { data } = await supabase.rpc('confession_quota_status');
  return data || { limit: 2, used: 0, remaining: 2 };
}
