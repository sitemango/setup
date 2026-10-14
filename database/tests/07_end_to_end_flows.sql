-- =============================================================================
-- Campus+ database tests — 07 end-to-end production flows
-- =============================================================================
-- One continuous story, driven entirely through the *real* authorization
-- boundaries (student clients, staff clients, the operator's secret key). No
-- test calls an internal helper to "make it work": every write is attempted by
-- the role that would attempt it in production, and every denial is a denial the
-- product relies on.
--
-- The 20 flows from the pre-UI audit:
--   1 signup · 2 profile · 3 post · 4 comment · 5 search · 6 DM · 7 Seen ·
--   8 listing · 9 listing report · 10 moderator action · 11 official event ·
--   12 unauthorized event · 13 Random match · 14 Random privacy · 15 block ·
--   16 report · 17 notification · 18 role change · 19 admin-only action ·
--   20 suspension
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Signup and 2. profile creation (operator provisions auth, student onboards)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('91000000-0000-4000-a000-000000000001', 'gauri.pillai@pccoepune.org'),
  ('91000000-0000-4000-a000-000000000002', 'harsh.vaidya@pccoepune.org'),
  ('91000000-0000-4000-a000-000000000003', 'irfan_mod@pccoepune.org'),
  ('91000000-0000-4000-a000-000000000004', 'jaya_admin@pccoepune.org')
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('91000000-0000-4000-a000-000000000001', 'gauri_e2e', 'Gauri Pillai'),
    ('91000000-0000-4000-a000-000000000002', 'harsh_e2e', 'Harsh Vaidya'),
    ('91000000-0000-4000-a000-000000000003', 'irfan_mod', 'Irfan Qureshi'),
    ('91000000-0000-4000-a000-000000000004', 'jaya_admin', 'Jaya Menon')
  ) as t(id, username, name)
  loop
    perform set_config('request.jwt.claim.sub', r.id, false);
    perform public.complete_profile(p_username => r.username, p_display_name => r.name,
      p_branch => 'Computer Engineering', p_year => 'Third Year');
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub', '', false);
select public.grant_role((select id from public.profiles where username = 'irfan_mod'), 'moderator');
select public.grant_role((select id from public.profiles where username = 'jaya_admin'), 'admin');

do $$
begin
  perform public.test_assert(
    (select count(*) from public.profile_private pp
      join public.profiles p on p.id = pp.profile_id
     where p.username in ('gauri_e2e', 'harsh_e2e', 'irfan_mod', 'jaya_admin')
       and pp.profile_completed) = 4,
    '1–2. every onboarded student has a complete profile and private row'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. A student posts
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_post uuid;
begin
  insert into public.posts (author_id, body, kind)
  values (public.current_profile_id(),
          'Library has a lost-and-found box near the reading room entrance.',
          'post')
  returning id into v_post;
  perform public.test_assert(v_post is not null, '3. a student must be able to publish a post');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Another student comments, and the counter follows the source rows
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_post uuid;
  v_comment uuid;
begin
  select id into v_post from public.posts
   where body like 'Library has a lost-and-found%';

  insert into public.comments (post_id, author_id, body)
  values (v_post, public.current_profile_id(), 'It is on the first floor, next to the notice board.')
  returning id into v_comment;

  perform public.test_assert(v_comment is not null, '4. a student must be able to comment');
  perform public.test_assert(
    (select comment_count from public.posts where id = v_post) = 1,
    '4. the comment counter must be maintained by the database'
  );

  insert into public.reactions (user_id, target_type, target_id, kind)
  values (public.current_profile_id(), 'post', v_post, 'like');

  perform public.test_assert(
    (select reaction_count from public.posts where id = v_post) = 1,
    '4. the reaction counter must be maintained by the database'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Search respects visibility, and blocks hide content from the blocker
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_hits integer;
  v_titles text;
  v_trending integer;
  v_feed integer;
begin
  select count(*) into v_hits from public.global_search('lost', null, 20, 0);
  perform public.test_assert(v_hits >= 1, '5. search must find the post that exists');

  select string_agg(title, ' | ') into v_titles from public.global_search('lost', null, 20, 0);
  perform public.test_assert(
    v_titles like '%lost-and-found%',
    '5. the matching post must be the one returned'
  );

  select count(*) into v_trending from public.trending_posts(20, 0);
  perform public.test_assert(v_trending >= 1, '5. trending must return the post with reactions');

  select count(*) into v_feed from public.campus_feed(20, 0, null);
  perform public.test_assert(v_feed >= 1, '5. the campus feed must return recent posts');

  -- Search is scoped: a bogus scope yields nothing rather than everything.
  perform public.test_assert(
    (select count(*) from public.global_search('lost', 'not_a_scope', 20, 0)) = 0,
    '5. an unknown search scope must return no rows'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Direct message + 7. Seen receipt
-- ---------------------------------------------------------------------------
do $$
declare
  v_harsh uuid;
  v_conversation uuid;
  v_seen timestamptz;
begin
  select id into v_harsh from public.profiles where username = 'harsh_e2e';
  v_conversation := public.get_or_create_direct_conversation(v_harsh);

  insert into public.messages (conversation_id, sender_id, body)
  values (v_conversation, public.current_profile_id(), 'Are you coming to the coding club meet?');

  perform public.test_assert(v_conversation is not null, '6. a direct conversation must be creatable');
  perform public.test_assert(
    (select count(*) from public.messages where conversation_id = v_conversation) = 1,
    '6. the message must be stored'
  );

  select value into v_conversation from public.__test_scratch where key = 'noop' limit 1;

  v_seen := public.mark_conversation_read(
    (select c.id from public.conversations c
      join public.conversation_members m on m.conversation_id = c.id
     where m.user_id = public.current_profile_id() and c.kind = 'direct' limit 1)
  );
  perform public.test_assert(v_seen is not null, '7. marking a conversation read must record a Seen time');
  perform public.test_assert(
    (select count(*) from public.message_reads
      where user_id = public.current_profile_id() and last_read_at is not null) >= 1,
    '7. the Seen receipt must be persisted for the other member to see'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. A marketplace listing, and 9. reporting it
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_listing uuid;
  v_category uuid;
begin
  select id into v_category from public.marketplace_categories where is_active limit 1;

  insert into public.marketplace_listings (seller_id, title, description, price, condition, category_id, status)
  values (public.current_profile_id(), 'Engineering graphics kit',
          'Drawing board, set squares and French curve. Barely used, all pieces present.',
          450, 'good', v_category, 'active')
  returning id into v_listing;

  perform public.test_assert(v_listing is not null, '8. a student must be able to publish a listing');
  perform public.test_assert(
    public.marketplace_requires_approval() is false,
    '8. the default approval mode publishes immediately (post-moderation)'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_listing uuid;
  v_interest jsonb;
begin
  select id into v_listing from public.marketplace_listings where title = 'Engineering graphics kit' limit 1;

  -- Contact details are released by the interest action, not by a plain SELECT.
  v_interest := public.record_listing_interest(v_listing);
  perform public.test_assert((v_interest->>'ok')::boolean, '8. a student must be able to express interest');
  perform public.test_assert(
    (select count(*) from public.marketplace_interactions
      where listing_id = v_listing and user_id = public.current_profile_id() and kind = 'contact') = 1,
    '8. interest must be recorded as an interaction'
  );

  -- 9. Report the listing.
  insert into public.reports (reporter_id, target_type, target_id, reason, details)
  values (public.current_profile_id(), 'marketplace_listing', v_listing, 'scam',
          'The seller is asking for an advance payment.');
  perform public.test_assert(
    (select count(*) from public.reports where target_id = v_listing and status = 'pending') = 1,
    '9. a listing must be reportable through the central report system'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. The moderator acts on the report (and the seller is told)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000003', false);

do $$
declare
  v_report uuid;
  v_listing uuid;
begin
  select id, target_id into v_report, v_listing
  from public.reports where target_type = 'marketplace_listing' and status = 'pending' limit 1;

  perform public.assign_report(v_report);
  perform public.resolve_report(v_report, 'resolved', 'Removed: suspected advance-fee scam.', 'remove');

  perform public.test_assert(
    (select status from public.marketplace_listings where id = v_listing) = 'removed',
    '10. the moderator action must take the listing down'
  );
  perform public.test_assert(
    (select status from public.reports where id = v_report) = 'resolved',
    '10. the report must be closed with a resolution'
  );
  perform public.test_assert(
    (select reviewed_by from public.reports where id = v_report) = public.current_profile_id(),
    '10. the reviewing moderator must be recorded'
  );
end;
$$;

-- The reporter hears the outcome; the seller hears why their listing went away.
do $$
begin
  perform public.test_assert(
    (select count(*) from public.audit_logs) = 0,
    '10. a moderator must not read the audit log without the audit permission'
  );
  perform public.test_assert(
    (select count(*) from public.moderation_actions where action = 'moderation.content_remove') >= 1,
    '10. the moderation trail must record the action'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000002', false);

do $$
begin
  perform public.test_assert(
    (select count(*) from public.notifications
      where recipient_id = public.current_profile_id() and type = 'moderation_notice') = 1,
    '10. the content owner must be notified about a moderation decision'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Official event by a permitted role, 12. refused for a student
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000003', false);

do $$
declare
  v_event uuid;
begin
  insert into public.events (title, description, starts_on, start_time, location,
                             organizer, created_by, updated_by, status, published_at)
  values ('Campus+ audit walkthrough', 'A short session on how the platform stores data.',
          current_date + 3, '16:30', 'Seminar Hall 2', 'Computer Department',
          public.current_profile_id(), public.current_profile_id(), 'published', now())
  returning id into v_event;

  perform public.test_assert(v_event is not null, '11. a moderator with manage_events must be able to publish an official event');
  perform public.test_assert(
    (select created_by is not null and published_at is not null and status = 'published'
       from public.events where id = v_event),
    '11. official content must record who created and published it'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000001', false);

do $$
begin
  perform public.test_assert_denied(
    $sql$insert into public.events (title, description, starts_on, location, created_by, status)
         values ('Student-run official event', 'This must never be published as official.',
                 current_date + 5, 'Main Ground', public.current_profile_id(), 'published')$sql$,
    '12. a student must not be able to publish official content'
  );
  perform public.test_assert_denied(
    $sql$insert into public.notices (title, body, created_by, status)
         values ('Fake notice', 'Students must not be able to post to the noticeboard.',
                 public.current_profile_id(), 'published')$sql$,
    '12. a student must not be able to publish a notice'
  );
  perform public.test_assert_denied(
    $sql$insert into public.campus_deals (title, description, merchant, created_by, status, published_at)
         values ('Fake deal', 'Not a real deal.', 'Some merchant', public.current_profile_id(), 'published', now())$sql$,
    '12. a student must not be able to publish an official deal'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 13–14. Retired Random Chat is covered by 05_random_anonymity.sql.

-- 15. Block, 16. report, 17. notification
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000001', false);

-- Harsh publishes a second post so the block can be observed in discovery.
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000002', false);
do $$
begin
  insert into public.posts (author_id, body)
  values (public.current_profile_id(), 'Selling my old lab coat, barely used, DM if interested.');
end;
$$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_harsh uuid;
  v_visible_before integer;
begin
  select id into v_harsh from public.profiles where username = 'harsh_e2e';

  select count(*) into v_visible_before
  from public.global_search('lab coat', null, 20, 0);
  perform public.test_assert(v_visible_before = 1,
    '5/15. before blocking, the other student''s post is discoverable');

  insert into public.blocks (blocker_id, blocked_id, reason)
  values (public.current_profile_id(), v_harsh, 'Testing the block path');

  perform public.test_assert(public.is_blocked(public.current_profile_id(), v_harsh),
    '15. the block must be recorded and visible to the database');

  -- Blocking is symmetric for visibility: their content disappears from my
  -- search, feed and reads, and mine disappears from theirs.
  perform public.test_assert(
    (select count(*) from public.global_search('lab coat', null, 20, 0)) = 0,
    '15. a blocked author''s post must disappear from search'
  );
  perform public.test_assert(
    (select count(*) from public.posts where author_id = v_harsh) = 0,
    '15. a blocked author''s posts must not be readable at all'
  );
  perform public.test_assert(
    (select count(*) from public.public_profiles where id = v_harsh) = 0,
    '15. a blocked student must disappear from discovery surfaces'
  );

  -- Reporting a blocked student is still allowed on purpose: blocking stops
  -- interaction, it must not stop someone escalating harassment to moderators.
  insert into public.reports (reporter_id, target_type, target_id, reason, details)
  values (public.current_profile_id(), 'user', v_harsh, 'harassment',
          'Blocked them; reporting the messages too.');
  perform public.test_assert(
    (select count(*) from public.reports where reporter_id = public.current_profile_id()
       and target_type = 'user') = 1,
    '15/16. a student must still be able to report someone they have blocked'
  );

  -- 16. Report content that I can still see.
  insert into public.reports (reporter_id, target_type, target_id, reason, details)
  select public.current_profile_id(), 'post', p.id, 'misinformation', 'This looks misleading.'
  from public.posts p where p.author_id = public.current_profile_id() and p.status = 'published'
  limit 1;
  perform public.test_assert(
    (select count(*) from public.reports where reporter_id = public.current_profile_id() and target_type = 'post') = 1,
    '16. a student must be able to report content through the central system'
  );
end;
$$;

-- 17. Notifications flow through the single entry point and stay private.
-- Harsh and Gauri have blocked each other, so a notification between them must
-- be dropped. A third party (the moderator) can still notify either of them.

-- Harsh attempts it while blocked. His own inbox view cannot see Gauri's rows,
-- so the "nothing was stored" check below runs as the operator.
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000002', false);
select public.notify_user(
  (select id from public.profiles where username = 'gauri_e2e'),
  'community_activity', 'Blocked notification', 'This must not be delivered.',
  'post', null, '/home') is null as blocked_notification_dropped;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
begin
  perform public.test_assert(
    (select count(*) from public.notifications
      where recipient_id = (select id from public.profiles where username = 'gauri_e2e')
        and title = 'Blocked notification') = 0,
    '17. a blocked relationship must not store a notification'
  );
end;
$$;

-- The moderator notifies both students through the same entry point.
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000003', false);

do $$
declare
  v_gauri uuid;
  v_harsh uuid;
  v_note uuid;
begin
  select id into v_gauri from public.profiles where username = 'gauri_e2e';
  select id into v_harsh from public.profiles where username = 'harsh_e2e';

  v_note := public.notify_user(v_gauri, 'moderation_notice', 'Your post is being featured',
    'The moderators surfaced your lost-and-found post on the campus feed.', 'post', null, '/home');
  perform public.test_assert(v_note is not null,
    '17. a moderator must be able to notify a student');

  perform public.notify_user(v_harsh, 'moderation_notice', 'Your listing was reviewed',
    'The moderators looked at your marketplace listing.', 'listing', null, '/market');

  -- Staff cannot read someone else's inbox.
  perform public.test_assert(
    (select count(*) from public.notifications where recipient_id = v_gauri) = 0,
    '17. a notification must be invisible to everyone but its recipient'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_gauri uuid;
begin
  select id into v_gauri from public.profiles where username = 'gauri_e2e';
  perform public.test_assert(
    (select count(*) from public.notifications
      where recipient_id = v_gauri and title = 'Your post is being featured') = 1,
    '17. a notification must reach its recipient'
  );
  perform public.test_assert(
    (select count(*) from public.notifications
      where recipient_id <> public.current_profile_id()) = 0,
    '17. notifications addressed to someone else must be invisible'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. Role change (audited, rank-checked) · 19. admin-only action
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000004', false);

do $$
declare
  v_gauri uuid;
  v_can_review boolean;
begin
  select id into v_gauri from public.profiles where username = 'gauri_e2e';

  -- 19. Admin-only: change a platform setting through the audited RPC (direct
  -- UPDATE is revoked by design, so this function is the only in-app path).
  perform public.admin_set_platform_setting('allowed_email_domains', '["pccoepune.org"]'::jsonb);
  perform public.test_assert(
    (select value from public.platform_settings where key = 'allowed_email_domains') = '["pccoepune.org"]'::jsonb,
    '19. an admin must be able to change platform settings'
  );
  perform public.test_assert_denied(
    $sql$select public.admin_set_platform_setting('username_change_cooldown_days', '-5'::jsonb)$sql$,
    '19. invalid platform setting values must be rejected'
  );

  -- 18. Grant a role, then revoke it.
  perform public.grant_role(v_gauri, 'moderator');
  perform public.test_assert(
    (select count(*) from public.user_roles where user_id = v_gauri and role_key = 'moderator') = 1,
    '18. an admin must be able to grant the moderator role'
  );
  perform public.test_assert(
    (select count(*) from public.audit_logs where action = 'admin.role_granted') >= 1,
    '19. the audit log must record the grant'
  );
  perform public.test_assert(
    (select count(*) from public.moderation_actions) >= 1,
    '19. moderation history must be readable by an admin'
  );

  perform public.revoke_role(v_gauri, 'moderator');
  perform public.test_assert(
    (select count(*) from public.user_roles where user_id = v_gauri and role_key = 'moderator') = 0,
    '18. an admin must be able to revoke the role'
  );
end;
$$;

-- The promotion is immediately effective for the promoted student…
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000001', false);
do $$
begin
  perform public.test_assert(not public.has_permission('review_reports'),
    '18. the revoked moderator must no longer hold moderation permissions');
  perform public.test_assert_denied(
    $sql$update public.platform_settings set value = '"open"'::jsonb where key = 'allowed_email_domains'$sql$,
    '19. a student must not be able to write platform settings directly'
  );
  perform public.test_assert_denied(
    $sql$select public.admin_set_platform_setting('allowed_email_domains', '["evil.example"]'::jsonb)$sql$,
    '19. a student must not be able to change platform settings'
  );
  perform public.test_assert(
    (select count(*) from public.audit_logs) = 0,
    '19. a student must not be able to read the audit log'
  );
end;
$$;

-- A moderator is staff, but platform configuration is still out of reach.
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000003', false);
do $$
begin
  perform public.test_assert_denied(
    $sql$select public.admin_set_platform_setting('allowed_email_domains', '["evil.example"]'::jsonb)$sql$,
    '19. a moderator must not be able to change platform settings'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 20. Suspension ends the student's ability to write, everywhere at once
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000004', false);

do $$
declare
  v_harsh uuid;
begin
  select id into v_harsh from public.profiles where username = 'harsh_e2e';
  perform public.admin_set_account_status(v_harsh, 'suspended', 'Audit flow 20', 5);
end;
$$;

select set_config('request.jwt.claim.sub', '91000000-0000-4000-a000-000000000002', false);

do $$
begin
  perform public.test_assert_denied(
    $sql$insert into public.comments (post_id, author_id, body)
         select id, public.current_profile_id(), 'Commenting while suspended.'
         from public.posts limit 1$sql$,
    '20. a suspended student must not be able to comment'
  );
  perform public.test_assert_denied(
    $sql$select public.get_or_create_direct_conversation((select id from public.profiles where username = 'gauri_e2e'))$sql$,
    '20. a suspended student must not be able to start conversations'
  );
  perform public.test_assert_denied(
    $sql$insert into public.marketplace_listings (seller_id, title, description, price, category_id)
         select public.current_profile_id(), 'Suspended listing', 'Not allowed.', 10, c.id
         from public.marketplace_categories c limit 1$sql$,
    '20. a suspended student must not be able to list items'
  );
  perform public.test_assert(
    (select count(*) from public.notifications where recipient_id = public.current_profile_id()) >= 1,
    '20. a suspended student can still read their own notifications'
  );
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
