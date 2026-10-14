'use server';

import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { errors, fromPostgresError, toActionError } from '@/lib/errors';
import { can, toActor } from '@/lib/permissions/authorization';

export async function submitConfession(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    if (!can(toActor(user), 'submit_confessions')) throw errors.forbidden();
    const content = String(formData.get('content') || '').trim();
    if (content.length < 10 || content.length > 1000) throw errors.validation('Write between 10 and 1000 characters.');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('submit_confession', { p_content: content });
    if (error) throw fromPostgresError(error);
    if (!data?.ok && data?.code === 'daily_quota_exhausted') {
      return { ok: false, code: data.code, error: `You have used today’s ${data.limit} confessions. Your allowance resets at midnight IST.`, details: data };
    }
    return { ...data, ok: true };
  } catch (error) { return toActionError(error); }
}

export async function loadMoreConfessions(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const publishedAt = String(formData.get('published_at') || '');
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('browse_confessions', { p_cursor_published_at: publishedAt || null, p_cursor_id: id || null, p_limit: 12 });
    if (error) throw fromPostgresError(error);
    return { ok: true, items: data || [] };
  } catch (error) { return toActionError(error); }
}
