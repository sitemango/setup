-- Campus+ 025 — Random Confessions
-- Anonymous public content and its identity mapping are deliberately separate.

alter type public.report_target_type add value if not exists 'confession';

insert into public.permissions (key, label, description, group_name) values
 ('submit_confessions','Submit confessions','Submit anonymous confessions subject to the daily quota.','Social'),
 ('moderate_confessions','Moderate confessions','Review, publish, hide, or reject confession content without seeing author identity.','Moderation'),
 ('reveal_confession_identity','Reveal confession identity','Sensitive safety authority: reveal a confession author with a required, audited reason.','Administration')
on conflict (key) do update set label=excluded.label, description=excluded.description, group_name=excluded.group_name;

insert into public.role_permissions(role_key, permission_key)
select r.key, 'submit_confessions' from public.roles r where r.key in ('student','moderator','admin','super_admin') on conflict do nothing;
insert into public.role_permissions(role_key, permission_key)
select r.key, 'moderate_confessions' from public.roles r where r.key in ('moderator','admin','super_admin') on conflict do nothing;
insert into public.role_permissions(role_key, permission_key)
select r.key, 'reveal_confession_identity' from public.roles r where r.key in ('admin','super_admin') on conflict do nothing;

insert into public.feature_flags(key,label,description,group_name,enabled)
values ('random_confessions','Random Confessions','Anonymous, asynchronous confession feed.','social',true)
on conflict(key) do update set label=excluded.label, description=excluded.description;
insert into public.platform_settings(key,value,description,is_public)
values ('confession_daily_limit','2'::jsonb,'Maximum accepted submissions per profile per Asia/Kolkata calendar day.',true)
on conflict(key) do nothing;

create table public.confessions (
 id uuid primary key default gen_random_uuid(),
 content text not null check (length(btrim(content)) between 10 and 1000 and content=btrim(content)),
 status text not null default 'pending' check(status in ('pending','published','hidden','rejected','removed')),
 submitted_at timestamptz not null default clock_timestamp(),
 published_at timestamptz,
 moderated_at timestamptz,
 moderation_note text check(moderation_note is null or length(moderation_note)<=1000),
 constraint confession_publication_time check ((status='published' and published_at is not null) or status<>'published')
);
create index confessions_public_cursor_idx on public.confessions(published_at desc,id desc) where status='published';
create index confessions_moderation_idx on public.confessions(status,submitted_at asc);

create table public.confession_identities (
 confession_id uuid primary key references public.confessions(id) on delete restrict,
 profile_id uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
create index confession_identities_profile_idx on public.confession_identities(profile_id,created_at desc);

-- A durable ledger means deletion or later moderation can never refund quota.
create table public.confession_daily_quotas (
 profile_id uuid not null references public.profiles(id) on delete restrict,
 ist_day date not null,
 accepted_count integer not null check(accepted_count between 0 and 100),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(profile_id,ist_day)
);

alter table public.confessions enable row level security;
alter table public.confession_identities enable row level security;
alter table public.confession_daily_quotas enable row level security;
-- No direct policies. All access is through narrow RPCs; this also prevents column-level identity leaks.
revoke all on public.confessions, public.confession_identities, public.confession_daily_quotas from anon, authenticated, public;
grant all on public.confessions, public.confession_identities, public.confession_daily_quotas to service_role;

create or replace function public.submit_confession(p_content text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_profile uuid := public.current_profile_id(); v_day date := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
 v_limit integer; v_count integer; v_id uuid;
begin
 if v_profile is null or not public.has_permission('submit_confessions') then raise exception 'Not permitted.' using errcode='42501'; end if;
 if p_content is null or length(btrim(p_content)) not between 10 and 1000 then raise exception 'A confession must be between 10 and 1000 characters.' using errcode='22023'; end if;
 v_limit := greatest(1,least(public.setting_int('confession_daily_limit',2),20));
 insert into public.confession_daily_quotas(profile_id,ist_day,accepted_count) values(v_profile,v_day,0)
 on conflict(profile_id,ist_day) do nothing;
 select accepted_count into v_count from public.confession_daily_quotas where profile_id=v_profile and ist_day=v_day for update;
 if v_count >= v_limit then
  return jsonb_build_object('ok',false,'code','daily_quota_exhausted','remaining',0,'limit',v_limit,'ist_day',v_day);
 end if;
 insert into public.confessions(content) values(btrim(p_content)) returning id into v_id;
 insert into public.confession_identities(confession_id,profile_id) values(v_id,v_profile);
 update public.confession_daily_quotas set accepted_count=accepted_count+1,updated_at=clock_timestamp() where profile_id=v_profile and ist_day=v_day returning accepted_count into v_count;
 return jsonb_build_object('ok',true,'id',v_id,'status','pending','remaining',v_limit-v_count,'limit',v_limit,'ist_day',v_day);
end $$;

create or replace function public.confession_quota_status()
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare v_profile uuid:=public.current_profile_id(); v_day date:=(clock_timestamp() at time zone 'Asia/Kolkata')::date; v_limit integer; v_count integer;
begin
 if v_profile is null then raise exception 'Not permitted.' using errcode='42501'; end if;
 v_limit:=greatest(1,least(public.setting_int('confession_daily_limit',2),20));
 select accepted_count into v_count from public.confession_daily_quotas where profile_id=v_profile and ist_day=v_day;
 return jsonb_build_object('limit',v_limit,'used',coalesce(v_count,0),'remaining',greatest(v_limit-coalesce(v_count,0),0),'ist_day',v_day);
end $$;

create or replace function public.browse_confessions(p_cursor_published_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 12)
returns table(id uuid,content text,published_at timestamptz) language sql stable security definer set search_path=''
as $$
 select c.id,c.content,c.published_at from public.confessions c
 where c.status='published' and (p_cursor_published_at is null or (c.published_at,c.id)<(p_cursor_published_at,p_cursor_id))
 order by c.published_at desc,c.id desc limit greatest(1,least(coalesce(p_limit,12),24));
$$;

create or replace function public.list_confessions_for_moderation(p_limit integer default 50)
returns table(id uuid,content text,status text,submitted_at timestamptz,published_at timestamptz) language plpgsql stable security definer set search_path=''
as $$ begin
 if not public.has_permission('moderate_confessions') then raise exception 'Not permitted.' using errcode='42501'; end if;
 return query select c.id,c.content,c.status,c.submitted_at,c.published_at from public.confessions c order by (c.status='pending') desc,c.submitted_at asc limit least(greatest(p_limit,1),100);
end $$;

create or replace function public.moderate_confession(p_id uuid,p_status text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare v_old text; v_actor uuid:=public.current_profile_id();
begin
 if not public.has_permission('moderate_confessions') then raise exception 'Not permitted.' using errcode='42501'; end if;
 if p_status not in ('published','hidden','rejected','removed') or length(coalesce(p_note,''))>1000 then raise exception 'Invalid moderation request.' using errcode='22023'; end if;
 select status into v_old from public.confessions where id=p_id for update; if v_old is null then raise exception 'Confession not found.' using errcode='22023'; end if;
 update public.confessions set status=p_status,published_at=case when p_status='published' then coalesce(published_at,clock_timestamp()) else published_at end,moderated_at=clock_timestamp(),moderation_note=nullif(btrim(p_note),'') where id=p_id;
 insert into public.moderation_actions(moderator_id,action,target_type,target_id,previous_status,new_status,note) values(v_actor,'moderate_confession','confession',p_id,v_old,p_status,nullif(btrim(p_note),''));
 return jsonb_build_object('ok',true,'id',p_id,'status',p_status);
end $$;

create or replace function public.reveal_confession_identity(p_id uuid,p_reason text)
returns table(profile_id uuid) language plpgsql security definer set search_path=''
as $$ declare v_actor uuid:=public.current_profile_id();
begin
 if not public.has_permission('reveal_confession_identity') then raise exception 'Not permitted.' using errcode='42501'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 20 and 1000 then raise exception 'A specific investigation reason of at least 20 characters is required.' using errcode='22023'; end if;
 insert into public.audit_logs(actor_user_id,action,target_type,target_id,metadata,visibility) values(v_actor,'reveal_confession_identity','confession',p_id,jsonb_build_object('reason',btrim(p_reason)),'admin');
 return query select ci.profile_id from public.confession_identities ci where ci.confession_id=p_id;
end $$;

revoke all on function public.submit_confession(text),public.confession_quota_status(),public.browse_confessions(timestamptz,uuid,integer),public.list_confessions_for_moderation(integer),public.moderate_confession(uuid,text,text),public.reveal_confession_identity(uuid,text) from public,anon;
grant execute on function public.submit_confession(text),public.confession_quota_status(),public.browse_confessions(timestamptz,uuid,integer),public.list_confessions_for_moderation(integer),public.moderate_confession(uuid,text,text),public.reveal_confession_identity(uuid,text) to authenticated,service_role;

-- Preserve the retirement boundary for the old paired Random Chat RPCs.
revoke execute on function public.can_access_random_session(uuid,uuid),public.end_random_session(uuid,text),public.join_random_queue(),public.leave_random_queue(),public.random_other_participant(uuid,uuid),public.random_queue_state(),public.random_session_state(uuid),public.report_random_session(uuid,text,text),public.send_random_message(uuid,text,jsonb) from public,anon,authenticated;
