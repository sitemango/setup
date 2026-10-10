'use server';

/**
 * Posts, comments, reactions, polls and reports (spec §12–§15, §49).
 *
 * Everything here is a thin, validating layer over the database: RLS decides
 * who may write, guard triggers protect counters and moderation columns, and
 * `record_mentions()` owns mention resolution (blocks, inactive accounts,
 * deduplication) so the application never re-implements it.
 */

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { extractMentionUsernames } from '@/lib/mentions';
import { enforceRateLimit } from '@/lib/ratelimit';
import { notify } from '@/lib/notifications';
import { ROUTES } from '@/lib/constants';
import {
  validate, postSchema, commentSchema, discussionSchema, reportSchema, gifRefValidator,
} from '@/lib/validation/schemas';

const fail = (error) => toActionError(error);

function revalidateFeed() {
  revalidatePath('/home');
  revalidatePath('/explore');
}

/**
 * Mentions go through the single supported path: the definer RPC records them
 * (filtering blocks and inactive accounts), then each resolved student is
 * notified through `notify_user()`.
 */
async function applyMentions(supabase, { text, sourceType, sourceId, url, actorId }) {
  const usernames = extractMentionUsernames(text || '');
  if (!usernames.length) return [];

  const { data, error } = await supabase.rpc('record_mentions', {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_usernames: usernames,
  });
  if (error) return [];

  const mentioned = (data || []).filter((row) => row.user_id && row.user_id !== actorId);
  await Promise.all(
    mentioned.map((row) =>
      notify(supabase, {
        recipientId: row.user_id,
        type: 'mention',
        title: 'You were mentioned',
        body: `@${row.username} mentioned you in a ${sourceType}.`,
        referenceType: sourceType,
        referenceId: sourceId,
        url,
      }),
    ),
  );
  return mentioned;
}

/* -------------------------------------------------------------------------- */
/* Posts                                                                       */
/* -------------------------------------------------------------------------- */

export async function createPost(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'post_create', user.profile.id);

    const kind =
      formData.get('kind') === 'poll' ? 'poll' : formData.get('kind') === 'discussion' ? 'discussion' : 'post';
    const title = formData.get('title');
    const body = String(formData.get('body') || '').trim();
    const communityId = formData.get('community_id') || null;
    const input = {
      title,
      body: kind === 'poll' && !body ? title : body,
      // Standalone posts always belong to this campus. Community posts keep the
      // separate membership-scoped visibility regardless of client form values.
      visibility: communityId ? 'community' : 'campus',
      community_id: communityId,
      gif: formData.get('gif') || null,
      is_poll: kind === 'poll',
      poll_question: title,
      poll_options: formData.getAll('poll_options').map((value) => String(value || '')).filter(Boolean),
      poll_closes_at: formData.get('poll_closes_at') || null,
    };

    const schema =
      kind === 'post'
        ? { ...postSchema, gif: gifRefValidator }
        : {
            ...discussionSchema,
            visibility: postSchema.visibility,
            community_id: postSchema.community_id,
            gif: gifRefValidator,
            poll: postSchema.poll,
            poll_question: () => ({ ok: true, value: null }),
            poll_options: () => ({ ok: true, value: [] }),
            is_poll: () => ({ ok: true, value: kind === 'poll' }),
            poll_closes_at: () => ({ ok: true, value: null }),
          };

    const checked = validate(input, schema);
    if (!checked.ok) throw errors.validation('Please check the post and try again.', checked.errors);
    const values = checked.data;

    const poll = kind === 'poll' ? values.poll : null;
    const { data: post, error } = await supabase
      .from('posts')
      .insert({
        author_id: user.profile.id,
        kind,
        title: kind === 'post' ? null : poll ? poll.question : values.title,
        body: poll ? poll.question : values.body,
        gif: values.gif || null,
        visibility: values.visibility || 'campus',
        community_id: values.community_id || null,
        status: 'published',
        poll_closes_at: poll ? poll.closes_at || null : null,
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot post there.' });

    if (poll?.options?.length) {
      const { error: optionError } = await supabase.from('poll_options').insert(
        poll.options.map((label, index) => ({ post_id: post.id, label, position: index })),
      );
      if (optionError) {
        // Do not leave a poll with no options behind.
        await supabase.rpc('delete_own_content', { p_target_type: 'post', p_target_id: post.id });
        throw fromPostgresError(optionError, { rls: 'The poll options could not be saved.' });
      }
    }

    await applyMentions(supabase, {
      text: [kind === 'post' ? null : values.title, values.body].filter(Boolean).join(' '),
      sourceType: 'post',
      sourceId: post.id,
      url: ROUTES.post(post.id),
      actorId: user.profile.id,
    });

    revalidateFeed();
    return { ok: true, id: post.id };
  } catch (error) {
    return fail(error);
  }
}

export async function deletePost(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    // The audited soft-delete path: evidence is preserved for moderation.
    const { error } = await supabase.rpc('delete_own_content', { p_target_type: 'post', p_target_id: id });
    if (error) throw fromPostgresError(error);
    revalidateFeed();
    revalidatePath(ROUTES.post(id));
    revalidatePath(ROUTES.profile);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function restorePost(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('restore_own_content', { p_target_type: 'post', p_target_id: id });
    if (error) throw fromPostgresError(error);
    revalidateFeed();
    revalidatePath(ROUTES.post(id));
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Comments                                                                    */
/* -------------------------------------------------------------------------- */

export async function createComment(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'comment_create', user.profile.id);

    const checked = validate(
      {
        body: formData.get('body'),
        parent_id: formData.get('parent_id') || null,
        gif: formData.get('gif') || null,
      },
      { ...commentSchema, gif: gifRefValidator },
    );
    if (!checked.ok) throw errors.validation('Please check your comment.', checked.errors);
    const values = checked.data;
    const postId = String(formData.get('post_id') || '');

    const { data: comment, error } = await supabase
      .from('comments')
      .insert({
        post_id: postId,
        parent_id: values.parent_id || null,
        author_id: user.profile.id,
        body: values.body,
        gif: values.gif || null,
        status: 'published',
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot comment on that post.' });

    const { data: post } = await supabase.from('posts').select('id, author_id').eq('id', postId).maybeSingle();

    if (post && post.author_id !== user.profile.id) {
      await notify(supabase, {
        recipientId: post.author_id,
        type: 'comment',
        title: 'New comment on your post',
        body: `${user.profile.display_name || `@${user.profile.username}`} commented.`,
        referenceType: 'post',
        referenceId: post.id,
        url: ROUTES.post(post.id),
      });
    }
    if (values.parent_id) {
      const { data: parent } = await supabase
        .from('comments')
        .select('id, author_id')
        .eq('id', values.parent_id)
        .maybeSingle();
      if (parent && parent.author_id !== user.profile.id && parent.author_id !== post?.author_id) {
        await notify(supabase, {
          recipientId: parent.author_id,
          type: 'reply',
          title: 'New reply to your comment',
          body: `${user.profile.display_name || `@${user.profile.username}`} replied.`,
          referenceType: 'comment',
          referenceId: comment.id,
          url: ROUTES.post(postId),
        });
      }
    }

    await applyMentions(supabase, {
      text: values.body,
      sourceType: 'comment',
      sourceId: comment.id,
      url: ROUTES.post(postId),
      actorId: user.profile.id,
    });

    revalidatePath(ROUTES.post(postId));
    revalidateFeed();
    return { ok: true, id: comment.id };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteComment(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const postId = String(formData.get('post_id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('delete_own_content', { p_target_type: 'comment', p_target_id: id });
    if (error) throw fromPostgresError(error);
    if (postId) revalidatePath(ROUTES.post(postId));
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Reactions — one control, the backend's supported kind (spec §15)            */
/* -------------------------------------------------------------------------- */

const REACTION_KIND = 'like';

export async function toggleReaction(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const targetType = String(formData.get('target_type') || 'post');
    const targetId = String(formData.get('target_id') || '');
    if (!['post', 'comment', 'project'].includes(targetType)) throw errors.validation('That cannot be reacted to.');
    const supabase = await getServerClient();

    const { data: existing } = await supabase
      .from('reactions')
      .select('id')
      .eq('user_id', user.profile.id)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .eq('kind', REACTION_KIND)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.from('reactions').delete().eq('id', existing.id);
      if (error) throw fromPostgresError(error);
    } else {
      await enforceRateLimit(supabase, 'reaction_toggle', user.profile.id);
      const { error } = await supabase
        .from('reactions')
        .insert({ user_id: user.profile.id, target_type: targetType, target_id: targetId, kind: REACTION_KIND });
      if (error) throw fromPostgresError(error);
    }

    if (targetType === 'post') {
      revalidatePath(ROUTES.post(targetId));
      revalidateFeed();
    } else if (targetType === 'project') {
      revalidatePath(ROUTES.project(targetId));
    }
    return { ok: true, reacted: !existing };
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Polls                                                                       */
/* -------------------------------------------------------------------------- */

export async function votePoll(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const postId = String(formData.get('post_id') || '');
    const optionId = String(formData.get('option_id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase
      .from('poll_votes')
      .insert({ post_id: postId, option_id: optionId, user_id: user.profile.id });
    if (error) throw fromPostgresError(error, { unique: 'You have already voted in this poll.' });
    revalidatePath(ROUTES.post(postId));
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Reports — one dialog for every target type (spec §49)                       */
/* -------------------------------------------------------------------------- */

export async function reportContent(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'report_create', user.profile.id);

    const checked = validate(
      {
        target_type: formData.get('target_type'),
        target_ref: formData.get('target_ref'),
        reason: formData.get('reason'),
        details: formData.get('details'),
        session_id: formData.get('session_id') || null,
      },
      reportSchema,
    );
    if (!checked.ok) throw errors.validation('Please choose a reason for the report.', checked.errors);
    const values = checked.data;

    // Random sessions go through their own definer function: participants cannot
    // read `random_sessions`, so a direct insert would be refused by design.
    if (values.target_type === 'random_session') {
      const session = values.session_id || values.target_ref;
      const { error } = await supabase.rpc('report_random_session', {
        p_session: session,
        p_reason: values.reason,
        p_details: values.details || null,
      });
      if (error) throw fromPostgresError(error);
      return { ok: true };
    }

    const { error } = await supabase.from('reports').insert({
      reporter_id: user.profile.id,
      target_type: values.target_type,
      target_id: values.target_ref,
      reason: values.reason,
      details: values.details || null,
    });
    if (error) throw fromPostgresError(error, { rls: 'That could not be reported.' });
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
