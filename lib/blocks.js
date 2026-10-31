/**
 * Blocking (spec §60, §14).
 *
 * Blocking is enforced at the database level: `public.is_blocked(a, b)` is used
 * inside RLS policies for conversations, messages, direct interactions and
 * discovery. These helpers are the UI/server-action layer on top of that.
 */

import 'server-only';
import { fromPostgresError, errors } from '@/lib/errors';
import { normalizeUsername } from '@/lib/utils';

/** Resolve a public identifier (@username or uuid) to a profile id. */
export async function resolveProfileId(supabase, ref) {
  if (!supabase || !ref) return null;
  const value = String(ref).trim().replace(/^@/, '');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  // `public_profiles` is the public projection: it exposes no private columns and
  // reports account state as a boolean `is_active` instead of the raw status.
  const { data } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_active')
    .eq(isUuid ? 'id' : 'username', isUuid ? value : normalizeUsername(value))
    .maybeSingle();
  return data || null;
}

export async function blockUser(supabase, { userId, targetProfileId, reason = null }) {
  if (!userId) throw errors.unauthenticated();
  if (!targetProfileId) throw errors.notFound('That student could not be found.');
  if (userId === targetProfileId) throw errors.validation('You cannot block yourself.');

  const { data: existing } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_id', userId)
    .eq('blocked_id', targetProfileId)
    .maybeSingle();
  if (existing) return { ok: true, alreadyBlocked: true };

  const { error } = await supabase.from('blocks').insert({
    blocker_id: userId,
    blocked_id: targetProfileId,
    reason: reason ? String(reason).slice(0, 300) : null,
  });
  if (error) throw fromPostgresError(error, { unique: 'That student is already blocked.' });

  // Blocking also removes any pending Random queue entry (spec §25 abuse control).
  await supabase.from('random_queue').delete().eq('user_id', userId);
  return { ok: true };
}

export async function unblockUser(supabase, { userId, targetProfileId }) {
  if (!userId) throw errors.unauthenticated();
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', userId)
    .eq('blocked_id', targetProfileId);
  if (error) throw fromPostgresError(error);
  return { ok: true };
}

export async function listBlockedUsers(supabase, userId, { limit = 100 } = {}) {
  const { data, error } = await supabase
    .from('blocks')
    .select('id, created_at, blocked:profiles!blocks_blocked_id_fkey ( id, username, display_name )')
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw fromPostgresError(error);
  // PostgREST keeps the aliased embed nested. Return the profile-shaped list
  // Settings consumes, retaining the block timestamp while preserving the
  // related profile id (the block row id is not a valid ProfileActions id).
  return (data || []).flatMap(({ blocked: profile, created_at }) => (
    profile ? [{ ...profile, created_at }] : []
  ));
}

/** Is there a block in either direction? */
export async function isBlockedBetween(supabase, a, b) {
  const { data, error } = await supabase.rpc('is_blocked', { a, b });
  if (error) return false;
  return data === true;
}
