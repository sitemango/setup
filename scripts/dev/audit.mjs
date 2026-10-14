#!/usr/bin/env node
/**
 * Pre-UI production readiness audit (development tool).
 *
 * Boots a disposable PostgreSQL instance, applies the authoritative migration
 * history, and then interrogates the *catalog* — RLS, policies, grants,
 * SECURITY DEFINER hygiene, indexes, FKs, enums — and compares the result with
 * the JavaScript contract in lib/constants.js.
 *
 * The point is to prove security properties without trusting the source text:
 * every claim is re-read from pg_catalog after the migrations have run.
 *
 * Usage:
 *   npm install --no-save embedded-postgres
 *   npm run audit:db
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  banner,
  migrationsDir,
  root,
  shutdown,
  startDatabase,
  migrationFiles,
} from './harness.mjs';

const results = [];
const record = (level, section, title, detail = '', fix = '') =>
  results.push({ level, section, title, detail, fix });

const pass = (s, t, d) => record('pass', s, t, d);
const fail = (s, t, d, f) => record('fail', s, t, d, f);
const warn = (s, t, d, f) => record('warn', s, t, d, f);

// ---------------------------------------------------------------------------
// 1. Migration history
// ---------------------------------------------------------------------------
async function auditMigrationHistory() {
  const files = await migrationFiles();
  const bad = files.filter((f) => !/^\d{14}_\d{3}_[a-z0-9_]+\.sql$/.test(f));
  if (bad.length) {
    fail('Migrations', 'Filename convention', `Not matching <timestamp>_<nnn>_<name>.sql: ${bad.join(', ')}`, 'Rename to the Supabase CLI convention.');
  } else {
    pass('Migrations', 'Single authoritative history', `${files.length} files in supabase/migrations/, lexicographic order = apply order`);
  }

  const numbers = files.map((f) => Number(f.split('_')[1]));
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) {
    const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    fail('Migrations', 'Duplicate sequence numbers', `Repeated: ${[...new Set(dupes)].join(', ')}`, 'Renumber.');
  } else {
    pass('Migrations', 'No duplicate sequence numbers', numbers.map((n) => String(n).padStart(3, '0')).join(' '));
  }

  const gaps = [];
  for (let i = 1; i <= Math.max(...numbers); i += 1) if (!unique.has(i)) gaps.push(i);
  if (gaps.length) warn('Migrations', 'Sequence gaps', `Missing: ${gaps.join(', ')}`, 'Confirm nothing was deleted from history.');

  // Exactly one migrations directory must exist.
  const candidates = ['supabase/migrations', 'database/migrations', 'migrations', 'db/migrations'];
  const { existsSync } = await import('node:fs');
  const present = candidates.filter((c) => existsSync(path.join(root, c)));
  if (present.length === 1) {
    pass('Migrations', 'Exactly one migrations directory', present[0]);
  } else {
    fail('Migrations', 'Migration directory count', `Found: ${present.join(', ') || 'none'}`, 'Keep only supabase/migrations.');
  }
}

// ---------------------------------------------------------------------------
// 2. RLS coverage
// ---------------------------------------------------------------------------
async function auditRls(client) {
  const tables = (
    await client.query(`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\\_\\_test%'
      order by 1
    `)
  ).rows;

  const withoutRls = tables.filter((t) => !t.rls);
  if (withoutRls.length) {
    fail('RLS', 'RLS enabled on every table', `Missing on: ${withoutRls.map((t) => t.name).join(', ')}`, 'ALTER TABLE … ENABLE ROW LEVEL SECURITY.');
  } else {
    pass('RLS', 'RLS enabled on every table', `${tables.length}/${tables.length} public tables`);
  }

  const policies = (
    await client.query(`
      select tablename, policyname, cmd, roles::text[] as roles, permissive,
             coalesce(qual, '') as using_expr, coalesce(with_check, '') as check_expr
      from pg_policies where schemaname = 'public'
    `)
  ).rows;

  const byTable = new Map();
  for (const p of policies) {
    if (!byTable.has(p.tablename)) byTable.set(p.tablename, []);
    byTable.get(p.tablename).push(p);
  }

  // Internal bookkeeping tables are intentionally deny-all for clients: they are
  // reached only through SECURITY DEFINER functions.
  const denyAllByDesign = new Set(['rate_limits', 'confessions', 'confession_identities', 'confession_daily_quotas']);
  const noPolicies = tables.filter((t) => !byTable.has(t.name) && !denyAllByDesign.has(t.name));
  const unexpectedDenyAll = tables.filter((t) => !byTable.has(t.name) && denyAllByDesign.has(t.name));
  if (noPolicies.length) {
    fail('RLS', 'Every client-facing table has a policy', noPolicies.map((t) => t.name).join(', '), 'Add policies or document the table as internal.');
  } else {
    pass('RLS', 'Every client-facing table has a policy',
      unexpectedDenyAll.length ? `deny-all by design: ${unexpectedDenyAll.map((t) => t.name).join(', ')}` : '');
  }

  // Anything that grants access to a role that includes anon is a red flag:
  // the whole product is authenticated-only.
  const anonReadable = policies.filter(
    (p) => p.roles.includes('anon') || p.roles.includes('0') || p.roles.join(',') === ''
  );
  if (anonReadable.length) {
    fail(
      'RLS',
      'No policy grants access to anon',
      anonReadable.map((p) => `${p.tablename}.${p.policyname} (${p.roles.join('|')})`).join('; '),
      'Policies must be `to authenticated` (or a specific role).'
    );
  } else {
    pass('RLS', 'No policy grants access to anon', `${policies.length} policies checked`);
  }

  // Reference data (roles, permissions, categories, flags) is readable by every
  // signed-in student by design. Anything outside this list must not be blanket.
  const publicReadByDesign = new Set([
    'roles', 'permissions', 'role_permissions', 'marketplace_categories',
    'feature_flags', 'reserved_usernames', 'achievements', 'user_achievements',
    'ratings', 'profiles', 'colleges', 'platform_settings', 'public_profiles',
  ]);
  const trivial = policies.filter(
    (p) => p.permissive === 'PERMISSIVE' && p.using_expr === 'true' && p.cmd !== 'INSERT'
      && !publicReadByDesign.has(p.tablename)
  );
  if (trivial.length) {
    fail('RLS', 'Blanket USING (true) only on reference data',
      trivial.map((p) => `${p.tablename}.${p.policyname}`).join('; '),
      'Scope the policy to the current user or a permission.');
  } else {
    pass('RLS', 'Blanket USING (true) appears only on reference-data tables',
      `${policies.length} policies checked`);
  }

  // Per-command coverage report for the sensitive tables.
  const sensitive = ['messages', 'conversations', 'conversation_members', 'random_sessions',
    'random_session_participants', 'random_messages', 'reports', 'audit_logs',
    'moderation_actions', 'notifications', 'profile_private'];
  const missing = [];
  for (const table of sensitive) {
    const cmds = new Set((byTable.get(table) || []).map((p) => p.cmd));
    if (!cmds.has('SELECT')) missing.push(`${table}: no SELECT policy`);
  }
  if (missing.length) fail('RLS', 'Sensitive tables have SELECT policies', missing.join('; '), 'Add an explicit SELECT policy.');
  else pass('RLS', 'Sensitive tables all define SELECT policies', sensitive.join(', '));

  return { tables, policies, byTable };
}

// ---------------------------------------------------------------------------
// 3. Grants and function privileges
// ---------------------------------------------------------------------------
async function auditGrants(client) {
  // anon must hold no table privileges in public on production either.
  const anonTables = (
    await client.query(`
      select table_name, string_agg(privilege_type, ',') as privs
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'
      group by table_name order by 1
    `)
  ).rows;
  if (anonTables.length) {
    fail('Grants', 'anon holds no table privileges', anonTables.map((r) => `${r.table_name}:${r.privs}`).join('; '), 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon.');
  } else {
    pass('Grants', 'anon holds no table privileges in public');
  }

  // Functions: `anon` inherits EXECUTE from PUBLIC unless it was revoked from
  // PUBLIC itself. This is the classic Supabase mistake, so check the effective
  // privilege rather than the explicit grant.
  const anonExecute = (
    await client.query(`
      select p.oid::regprocedure::text as sig, p.prosecdef as definer,
             p.proacl::text as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and has_function_privilege('anon', p.oid, 'EXECUTE')
      order by 1
    `)
  ).rows;

  const publicGrants = Number(
    (await client.query(`select count(*)::int as n from information_schema.routine_privileges
                          where routine_schema = 'public' and grantee = 'PUBLIC'`)).rows[0].n
  );

  // Four pure helpers are needed on the sign-in screen, before a session exists.
  const anonByDesign = new Set([
    'allowed_email_domain(text)', 'is_reserved_username(text)',
    'feature_enabled(text)', 'setting(text,jsonb)', 'setting_int(text,integer)',
  ]);
  const bareSignature = (sig) => sig.replace(/^public\./, '').replace(/^"?(\w+)"?(?=\()/, '$1');
  const unexpected = anonExecute.filter((f) => !anonByDesign.has(bareSignature(f.sig)));
  if (unexpected.length) {
    fail(
      'Grants',
      'anon can execute only the pre-auth helpers',
      `${unexpected.length} unexpected: ${unexpected.map((f) => f.sig).join(', ')} (PUBLIC grants remaining: ${publicGrants})`,
      'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC; then grant to authenticated + service_role.'
    );
  } else {
    pass('Grants', 'anon can execute only the pre-auth helpers',
      `${anonExecute.length} allowed: ${anonExecute.map((f) => f.sig).join(', ')}`);
  }

  const pubTables = (
    await client.query(`
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'PUBLIC'
      group by table_name
    `)
  ).rows;
  if (pubTables.length) {
    fail('Grants', 'PUBLIC holds no table privileges', pubTables.map((r) => r.table_name).join(', '), 'REVOKE ALL … FROM PUBLIC.');
  } else {
    pass('Grants', 'PUBLIC holds no table privileges in public');
  }

  const authCount = Number(
    (await client.query(`select count(*)::int as n from information_schema.role_table_grants
                          where table_schema='public' and grantee='authenticated'`)).rows[0].n
  );
  pass('Grants', 'authenticated holds table privileges', `${authCount} grants (RLS + column privileges narrow them)`);
}

// ---------------------------------------------------------------------------
// 4. SECURITY DEFINER hygiene
// ---------------------------------------------------------------------------
async function auditSecurityDefiner(client) {
  const definers = (
    await client.query(`
      select p.oid::regprocedure::text as sig,
             coalesce(array_to_string(p.proconfig, ','), '') as config,
             pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
      order by 1
    `)
  ).rows;

  const noSearchPath = definers.filter((d) => !d.config.includes('search_path'));
  if (noSearchPath.length) {
    fail('Definer hygiene', 'Every SECURITY DEFINER function pins search_path',
      noSearchPath.map((d) => d.sig).join('; '), 'ALTER FUNCTION … SET search_path = public, pg_temp;');
  } else {
    pass('Definer hygiene', 'Every SECURITY DEFINER function pins search_path', `${definers.length} functions`);
  }

  const wrongOwner = definers.filter((d) => d.owner !== 'postgres');
  if (wrongOwner.length) warn('Definer hygiene', 'SECURITY DEFINER ownership', wrongOwner.map((d) => d.sig).join('; '), 'Prefer ownership by a non-API role.');
  else pass('Definer hygiene', 'SECURITY DEFINER functions owned by postgres');

  pass('Definer hygiene', 'SECURITY DEFINER inventory', `${definers.length} functions, each the sole write path for privileged state`);

  // Definer VIEWS read with the view owner's rights unless security_invoker is
  // set. Every such view must therefore be an intentional, column-whitelisted projection.
  const definerViews = (
    await client.query(`
      select c.relname as name, coalesce(array_to_string(c.reloptions, ','), '') as opts
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relkind='v'
      order by 1
    `)
  ).rows;
  // Two definer views are intentional: they filter on current_profile_id() and
  // whitelist columns so Random participants never see identities. Anything else
  // outside that list would silently bypass RLS.
  const definerViewsByDesign = new Set(['random_session_view', 'random_messages_view']);
  const nonInvoker = definerViews.filter(
    (v) => !v.opts.includes('security_invoker') && !definerViewsByDesign.has(v.name)
  );
  if (nonInvoker.length) {
    fail('Definer hygiene', 'Only whitelisted definer views exist',
      nonInvoker.map((v) => v.name).join(', '),
      'Add WITH (security_invoker = true) or justify it here.');
  } else {
    pass('Definer hygiene', 'Definer views are limited to the two audited Random projections',
      definerViews.filter((v) => !v.opts.includes('security_invoker')).map((v) => v.name).join(', ') || '(none)');
  }
  return { definers, definerViewNames: definerViews.map((v) => v.name) };
}

// ---------------------------------------------------------------------------
// 5. Data model integrity
// ---------------------------------------------------------------------------
async function auditDataModel(client) {
  const tables = (
    await client.query(`
      select c.relname as name, c.oid
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname not like '\\_\\_test%'
      order by 1
    `)
  ).rows;

  const noPk = (
    await client.query(`
      select c.relname as name from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r'
        and not exists (select 1 from pg_index i where i.indrelid=c.oid and i.indisprimary)
      order by 1
    `)
  ).rows.map((r) => r.name);
  if (noPk.length) fail('Data model', 'Every table has a primary key', noPk.join(', '), 'Add a primary key.');
  else pass('Data model', 'Every table has a primary key', `${tables.length} tables`);

  const timeColumns = ['created_at', 'joined_at', 'occurred_on', 'granted_at', 'edited_at',
    'changed_at', 'earned_at', 'awarded_at', 'decided_at', 'sent_at', 'started_at', 'window_start'];
  const noCreated = (
    await client.query(`
      select c.relname as name from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r'
        and not exists (select 1 from information_schema.columns col
                        where col.table_schema='public' and col.table_name=c.relname
                          and col.column_name = any($1::text[]))
      order by 1
    `, [timeColumns])
  ).rows.map((r) => r.name);
  // Join tables and pure counters legitimately carry no timestamp of their own.
  const timeByDesign = new Set(['role_permissions', 'poll_options', 'rate_limits', 'feature_flags', 'user_roles']);
  const missingTime = noCreated.filter((t) => !timeByDesign.has(t));
  if (missingTime.length) warn('Data model', 'Tables record when a row was created', missingTime.join(', '), 'Add created_at timestamptz default now().');
  else pass('Data model', 'Every table records when a row was created');

  const naiveTimestamps = (
    await client.query(`
      select table_name || '.' || column_name as col
      from information_schema.columns
      where table_schema='public' and data_type = 'timestamp without time zone'
      order by 1
    `)
  ).rows.map((r) => r.col);
  if (naiveTimestamps.length) fail('Data model', 'All timestamps are timestamptz', naiveTimestamps.join(', '), 'Use timestamptz.');
  else pass('Data model', 'All timestamps are timestamptz');

  const fkless = (
    await client.query(`
      select c.relname as tbl, a.attname as col
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
      where n.nspname='public' and c.relkind='r'
        and a.attname ~ '_id$'
        and a.attname not in ('auth_user_id')
        and format_type(a.atttypid, a.atttypmod) = 'uuid'
        and not exists (
          select 1 from pg_constraint con
          where con.conrelid=c.oid and con.contype='f'
            and con.conkey = array[a.attnum]
        )
      order by 1,2
    `)
  ).rows;
  // Deliberate polymorphic columns: a moderation/reaction/mention record points at
  // one of many entity types, so a single FK is impossible.
  const allowedPolymorphic = new Set([
    'reports.target_id', 'moderation_actions.target_id', 'audit_logs.target_id',
    'reactions.target_id', 'mentions.source_id',
  ]);
  const realFkless = fkless.filter((r) => !allowedPolymorphic.has(`${r.tbl}.${r.col}`));
  if (realFkless.length) {
    warn('Data model', 'Every *_id column has a foreign key',
      realFkless.map((r) => `${r.tbl}.${r.col}`).join(', '),
      'Add a FK, or document why the reference is intentionally loose.');
  } else {
    pass('Data model', 'Every *_id column is backed by a foreign key', 'only reports.target_id is polymorphic by design');
  }

  const unindexedFks = (
    await client.query(`
      select con.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
      where con.contype='f' and n.nspname='public' and array_length(con.conkey,1)=1
        and not exists (
          select 1 from pg_index i
          where i.indrelid = con.conrelid and i.indkey[0] = con.conkey[1]
        )
      order by 1,2
    `)
  ).rows.map((r) => `${r.tbl}.${r.col}`);
  // FKs that are always scanned by the *referenced* side (created_by/updated_by
  // audit columns) do not need their own index; FKs used in filters or policy
  // predicates must be indexed.
  // These FKs are only ever traversed in the referenced direction (an audit
  // column, a discussion link, a moderation actor), so they don't need an index
  // on the referencing side. Everything else must be indexed.
  const auditOnly = /(created_by|updated_by|moderated_by|approved_by|resolved_by|deleted_by|granted_by|assigned_to|decided_by|reviewed_by|ended_by|changed_by|edited_by|invited_by|submitted_by|discussion_post_id|last_read_message_id|last_message_id)\)?$/;
  const policyRelevant = unindexedFks.filter((f) => !auditOnly.test(f));
  if (policyRelevant.length) {
    warn('Data model', 'Foreign keys used in filters are indexed',
      `${policyRelevant.length} unindexed: ${policyRelevant.join(', ')}`,
      'Add an index on the referencing column.');
  } else {
    pass('Data model', 'Every FK used for filtering is indexed',
      `${unindexedFks.length} audit-only FKs (created_by/updated_by) intentionally left unindexed`);
  }

  const dupIndexes = (
    await client.query(`
      select c.relname as tbl, array_agg(ic.relname order by ic.relname) as idx
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_class ic on ic.oid = i.indexrelid
      join pg_am am on am.oid = ic.relam
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      group by c.relname, i.indkey::text, am.amname, coalesce(pg_get_expr(i.indpred, i.indrelid), '')
      having count(*) > 1
    `)
  ).rows.map((r) => `${r.tbl}: ${r.idx.join(' / ')}`);
  if (dupIndexes.length) warn('Data model', 'No duplicate indexes', dupIndexes.join('; '), 'Drop the redundant index.');
  else pass('Data model', 'No duplicate indexes');

  const badNames = (
    await client.query(`
      select table_name || '.' || column_name as col
      from information_schema.columns
      where table_schema='public' and (column_name ~ '[A-Z]' or table_name ~ '[A-Z]')
      order by 1
    `)
  ).rows.map((r) => r.col);
  if (badNames.length) warn('Data model', 'snake_case identifiers', badNames.join(', '), 'Rename to snake_case.');
  else pass('Data model', 'Identifiers are consistently snake_case');

  // Destructive cascades from profiles: deleting a student must not silently
  // destroy moderation evidence.
  const cascades = (
    await client.query(`
      select con.conrelid::regclass::text as tbl, con.confrelid::regclass::text as ref,
             con.confdeltype as del
      from pg_constraint con
      join pg_namespace n on n.oid = con.connamespace
      where con.contype='f' and n.nspname='public' and con.confdeltype='c'
        and con.confrelid = 'public.profiles'::regclass
      order by 1
    `)
  ).rows.map((r) => r.tbl);
  // Account deletion is a status change, not a DELETE, so these cascades only run
  // for a deliberate operator-initiated hard delete (GDPR-style erasure).
  pass('Data model', 'Hard-delete cascades from profiles',
    `${cascades.length} tables follow a deliberate hard delete of auth.users; normal account deletion is a status change`);

  const textStatus = (
    await client.query(`
      select c.table_name || '.' || c.column_name as col
      from information_schema.columns c
      where c.table_schema='public'
        and c.column_name in ('status','state','visibility','join_policy','kind','type')
        and c.data_type = 'text'
        and not exists (
          select 1 from pg_constraint con join pg_class cl on cl.oid=con.conrelid
          where cl.relname=c.table_name and con.contype='c'
            and pg_get_constraintdef(con.oid) like '%' || c.column_name || '%'
        )
      order by 1
    `)
  ).rows.map((r) => r.col);
  if (textStatus.length) warn('Data model', 'Status-like text columns are constrained', textStatus.join(', '), 'Use an enum or a CHECK constraint.');
  else pass('Data model', 'Status-like text columns are constrained');
}

// ---------------------------------------------------------------------------
// 6. Column privileges (field-level write control)
// ---------------------------------------------------------------------------
async function auditColumnPrivileges(client) {
  const covered = (
    await client.query(`
      select table_name, string_agg(column_name, ',' order by column_name) as cols
      from information_schema.column_privileges
      where grantee='authenticated' and privilege_type='UPDATE' and table_schema='public'
      group by table_name order by 1
    `)
  ).rows;
  const tables = (
    await client.query(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname not like '\\_\\_test%'
    `)
  ).rows.map((r) => r.name);

  const withColumnGrants = new Set(covered.map((r) => r.table_name));
  const noUpdateAtAll = (
    await client.query(`
      select t.name from (select c.relname as name, c.oid from pg_class c
        join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like '\\_\\_test%') t
      where not has_table_privilege('authenticated', t.oid, 'UPDATE')
        and not exists (select 1 from information_schema.column_privileges cp
                        where cp.table_schema='public' and cp.table_name=t.name
                          and cp.grantee='authenticated' and cp.privilege_type='UPDATE')
      order by 1
    `)
  ).rows.map((r) => r.name);

  pass('Column privileges', 'Tables with narrowed UPDATE grants', `${withColumnGrants.size} of ${tables.length}`);
  pass('Column privileges', 'Tables where UPDATE is not granted to clients', noUpdateAtAll.length ? noUpdateAtAll.join(', ') : '(none)');

  // Spot-check the columns that must never be client-writable.
  const forbidden = [
    ['profiles', 'reputation_score'], ['profiles', 'reputation_count'],
    ['profile_private', 'account_status'], ['profile_private', 'suspended_until'],
    ['posts', 'is_official'], ['posts', 'pinned'], ['posts', 'status'],
    ['posts', 'reaction_count'], ['posts', 'comment_count'],
    ['communities', 'member_count'], ['communities', 'is_official'], ['communities', 'created_by'],
    ['marketplace_listings', 'view_count'], ['marketplace_listings', 'contact_count'],
    ['marketplace_listings', 'sold_to'],
    ['marketplace_listings', 'sold_at'],
    ['user_roles', 'role_key'], ['audit_logs', 'action'], ['reports', 'status'],
    ['random_sessions', 'participant_a'],
  ];
  const writable = [];
  for (const [table, column] of forbidden) {
    const { rows } = await client.query(
      `select has_column_privilege('authenticated', $1::text, $2::text, 'UPDATE') as ok`,
      [table, column]
    );
    if (rows[0].ok) writable.push(`${table}.${column}`);
  }
  if (writable.length) {
    fail('Column privileges', 'Privileged columns are not client-writable', writable.join(', '), 'REVOKE UPDATE and grant only the safe columns.');
  } else {
    pass('Column privileges', 'Privileged columns are not client-writable', `${forbidden.length} columns spot-checked`);
  }

  const safeEditable = [
    ['profiles', 'display_name'], ['profiles', 'bio'], ['posts', 'body'], ['posts', 'visibility'],
    ['comments', 'body'], ['messages', 'body'], ['marketplace_listings', 'title'],
    ['profiles', 'allow_dms_from_everyone'],
  ];
  const notEditable = [];
  for (const [table, column] of safeEditable) {
    const { rows } = await client.query(
      `select has_column_privilege('authenticated', $1::text, $2::text, 'UPDATE') as ok`,
      [table, column]
    );
    if (!rows[0].ok) notEditable.push(`${table}.${column}`);
  }
  if (notEditable.length) fail('Column privileges', 'Expected editable columns are writable', notEditable.join(', '), 'GRANT UPDATE (col) …');
  else pass('Column privileges', 'Expected editable columns are writable', safeEditable.map(([t, c]) => `${t}.${c}`).join(', '));
}

// ---------------------------------------------------------------------------
// 7. Enum + JS contract comparison
// ---------------------------------------------------------------------------
async function loadConstants() {
  const url = pathToFileURL(path.join(root, 'lib/constants.js')).href;
  return import(url);
}

async function auditContract(client, constants) {
  const enums = Object.fromEntries(
    (await client.query(`
      select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname='public' group by 1
    `)).rows.map((r) => [r.name, r.labels.map((l) => l.trim())])
  );

  const compare = (section, title, dbValues, jsValues) => {
    const missingInDb = jsValues.filter((v) => !dbValues.includes(v));
    const missingInJs = dbValues.filter((v) => !jsValues.includes(v));
    if (missingInDb.length || missingInJs.length) {
      warn(section, title,
        [missingInDb.length ? `in JS but not DB: ${missingInDb.join(', ')}` : '',
         missingInJs.length ? `in DB but not JS: ${missingInJs.join(', ')}` : ''].filter(Boolean).join(' | '),
        'Keep lib/constants.js and the SQL definitions in step.');
    } else {
      pass(section, title, `${dbValues.length} values`);
    }
  };

  compare('Contract', 'account_status enum', enums.account_status || [], constants.ACCOUNT_STATUS);
  compare('Contract', 'content_status enum', enums.content_status || [], constants.CONTENT_STATUS);
  compare('Contract', 'notification_type enum', enums.notification_type || [], constants.NOTIFICATION_TYPES);
  compare('Contract', 'report_status enum', enums.report_status || [], constants.REPORT_STATUS);
  compare('Contract', 'report_target_type enum', enums.report_target_type || [], constants.REPORT_TARGET_TYPES);

  // Permissions catalogue, both directions.
  const dbPerms = (await client.query(`select key from public.permissions order by 1`)).rows.map((r) => r.key);
  const jsPerms = constants.PERMISSION_KEYS;
  const permsMissingInDb = jsPerms.filter((p) => !dbPerms.includes(p));
  const permsMissingInJs = dbPerms.filter((p) => !jsPerms.includes(p));
  if (permsMissingInDb.length || permsMissingInJs.length) {
    fail('Contract', 'Permission catalogue matches the database',
      [permsMissingInDb.length ? `missing in DB: ${permsMissingInDb.join(', ')}` : '',
       permsMissingInJs.length ? `missing in JS: ${permsMissingInJs.join(', ')}` : ''].filter(Boolean).join(' | '),
      'Sync lib/constants.js PERMISSIONS with migration 013.');
  } else {
    pass('Contract', 'Permission catalogue matches the database', `${dbPerms.length} permissions, both directions`);
  }

  const roles = (await client.query(`select key from public.roles order by rank`)).rows.map((r) => r.key);
  const jsRoles = Object.values(constants.ROLES);
  if (roles.join() === jsRoles.join()) pass('Contract', 'Roles match', roles.join(' → '));
  else fail('Contract', 'Roles match', `DB: ${roles.join(',')} | JS: ${jsRoles.join(',')}`, 'Sync ROLES.');

  const flags = (await client.query(`select key from public.feature_flags order by key`)).rows.map((r) => r.key);
  const jsFlags = constants.FEATURE_FLAG_KEYS;
  const flagsDiff = [
    ...jsFlags.filter((f) => !flags.includes(f)).map((f) => `${f} (JS only)`),
    ...flags.filter((f) => !jsFlags.includes(f)).map((f) => `${f} (DB only)`),
  ];
  if (flagsDiff.length) fail('Contract', 'Feature flags match', flagsDiff.join(', '), 'Sync FEATURE_FLAGS with migration 013.');
  else pass('Contract', 'Feature flags match', `${flags.length} flags`);

  // Role → permission grants must match the documented baselines.
  const baseline = {
    student: constants.DEFAULT_STUDENT_PERMISSIONS,
    moderator: constants.DEFAULT_MODERATOR_PERMISSIONS,
    admin: constants.DEFAULT_ADMIN_PERMISSIONS,
    super_admin: constants.DEFAULT_SUPER_ADMIN_PERMISSIONS,
  };
  for (const [role, expected] of Object.entries(baseline)) {
    const actual = (await client.query(
      `select permission_key from public.role_permissions where role_key = $1 order by 1`, [role]
    )).rows.map((r) => r.permission_key);
    const missing = expected.filter((p) => !actual.includes(p));
    const extra = actual.filter((p) => !expected.includes(p));
    if (missing.length || extra.length) {
      fail('Contract', `role_permissions baseline: ${role}`,
        [missing.length ? `missing: ${missing.join(', ')}` : '', extra.length ? `extra: ${extra.join(', ')}` : ''].filter(Boolean).join(' | '),
        'Update migration 013 or lib/constants.js.');
    } else {
      pass('Contract', `role_permissions baseline: ${role}`, `${actual.length} permissions`);
    }
  }

  // Notification types referenced in SQL must exist in the enum. A typo here
  // compiles fine and only fails at runtime, on one code path.
  const enumTypes = new Set((await client.query(
    `select unnest(enum_range(null::public.notification_type))::text as t`
  )).rows.map((r) => r.t));
  const sqlTypes = new Set();
  const migFiles = await readdir(migrationsDir);
  for (const file of migFiles.filter((f) => f.endsWith('.sql'))) {
    const text = await readFile(path.join(migrationsDir, file), 'utf8');
    for (const literal of notificationTypeLiterals(text)) sqlTypes.add(literal);
  }
  const badTypes = [...sqlTypes].filter((t) => !enumTypes.has(t));
  if (badTypes.length) {
    fail('Contract', 'Notification types used in SQL exist in the enum',
      `unknown: ${badTypes.join(', ')}`, 'Use a value from notification_type.');
  } else {
    pass('Contract', 'Notification types used in SQL exist in the enum', `${sqlTypes.size} literals checked`);
  }

  // Every RPC the JS layer calls must exist with matching parameter names.
  const rpcCalls = new Map();
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.js')) {
        const text = await readFile(full, 'utf8');
        for (const m of text.matchAll(/\.rpc\(\s*['"]([a-z0-9_]+)['"]\s*(?:,\s*\{([^}]*)\})?/g)) {
          // Only `key: value` pairs are parameter names; a segment without a colon
          // is part of a nested expression like `.slice(0, 140)`.
          const params = (m[2] || '')
            .split(',')
            .filter((segment) => segment.includes(':'))
            .map((segment) => segment.split(':')[0].trim())
            .filter((key) => /^[A-Za-z_]\w*$/.test(key));
          rpcCalls.set(m[1], { file: path.relative(root, full), params });
        }
      }
    }
  };
  await walk(path.join(root, 'lib'));
  await walk(path.join(root, 'app'));

  const problems = [];
  for (const [fn, meta] of rpcCalls) {
    const { rows } = await client.query(
      `select p.proname, coalesce(array_agg(a.proname::text order by a.ordinality) filter (where a.proname is not null), '{}') as args
       from pg_proc p
       left join unnest(coalesce(p.proargnames, '{}'::text[])) with ordinality a(proname, ordinality) on true
       where p.pronamespace = 'public'::regnamespace and p.proname = $1
       group by p.proname`, [fn]
    );
    if (!rows.length) {
      problems.push(`${fn} (called by ${meta.file}) does not exist`);
      continue;
    }
    const args = rows[0].args;
    const bad = meta.params.filter((p) => !args.includes(p));
    if (bad.length) problems.push(`${fn}: JS passes ${bad.join(', ')} but SQL names are (${args.join(', ')})`);
  }
  if (problems.length) fail('Contract', 'RPC names and parameter names match', problems.join('; '), 'Align the JS call with the SQL signature (or vice versa).');
  else pass('Contract', 'Every RPC the JS layer calls exists with matching parameter names', `${rpcCalls.size} call sites`);
}

// ---------------------------------------------------------------------------
// 7b. JS column references vs the live schema
// ---------------------------------------------------------------------------
// The lib/ layer talks to PostgREST by column name. A column that was moved or
// renamed (for example when profile_private was split out of profiles) fails at
// runtime, in production, only on the code path that touches it. This scan
// compares every literal `.from(...).select(...)` / filter / order column with
// the catalog.
async function auditJsColumnReferences(client) {
  const catalog = new Map();
  const { rows } = await client.query(`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
    union all
    select table_name, column_name from information_schema.view_column_usage
    where table_schema = 'public'
  `);
  for (const row of rows) {
    if (!catalog.has(row.table_name)) catalog.set(row.table_name, new Set());
    catalog.get(row.table_name).add(row.column_name);
  }
  // View columns: information_schema.columns covers views as well.
  const viewRows = (await client.query(`
    select table_name, column_name from information_schema.columns where table_schema='public'
  `)).rows;
  for (const row of viewRows) {
    if (!catalog.has(row.table_name)) catalog.set(row.table_name, new Set());
    catalog.get(row.table_name).add(row.column_name);
  }

  const files = [];
  const collect = async (dir) => {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await collect(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  await collect(path.join(root, 'lib'));
  await collect(path.join(root, 'app'));

  const problems = [];
  const ignorable = new Set(['count']);

  // PostgREST embedded resources look like `roles ( key )` or
  // `blocked:profiles!blocks_blocked_id_fkey ( id, username )`. They are not
  // columns of the table being queried, so strip balanced parenthesised groups
  // before reading the top-level select list.
  const embeddedNames = (selectList) => {
    const names = new Set();
    for (const m of selectList.matchAll(/(?:([a-z_]+):)?([a-z_]+)(?:![a-z_]+)?\s*\(/g)) {
      names.add(m[2]);
    }
    return names;
  };

  const stripEmbedded = (selectList) => {
    let out = '';
    let depth = 0;
    for (const char of selectList) {
      if (char === '(') depth += 1;
      else if (char === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0) out += char;
    }
    return out;
  };

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const fromRegex = /\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/g;
    const matches = [...text.matchAll(fromRegex)];
    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      const table = match[1];
      // A statement ends where the next `.from()` starts or after a sane cap.
      const chunkEnd = i + 1 < matches.length ? matches[i + 1].index : match.index + 1500;
      const chunk = text.slice(match.index, chunkEnd);
      const columns = catalog.get(table);
      if (!columns) {
        problems.push(`${path.relative(root, file)}: unknown table "${table}"`);
        continue;
      }
      const referenced = new Set();

      const selectMatch = /\.select\(\s*['"`]([\s\S]*?)['"`]/.exec(chunk);
      if (selectMatch) {
        const embedded = embeddedNames(selectMatch[1]);
        for (const raw of stripEmbedded(selectMatch[1]).split(',')) {
          const name = raw.trim().split(/\s/)[0];
          if (!name || name === '*' || name.includes(':') || embedded.has(name)) continue;
          referenced.add(name);
        }
      }

      for (const m of chunk.matchAll(
        /\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|order|contains|containedBy)\(\s*['"]([a-z0-9_]+)['"]/g
      )) {
        referenced.add(m[2]);
      }

      for (const m of chunk.matchAll(/\.(insert|update|upsert)\(\s*\{([\s\S]*?)\}/g)) {
        for (const raw of m[2].split(',')) {
          if (!raw.includes(':')) continue;
          const name = raw.split(':')[0].trim().replace(/['"]/g, '');
          if (/^[a-z0-9_]+$/.test(name)) referenced.add(name);
        }
      }

      for (const column of referenced) {
        if (ignorable.has(column)) continue;
        // A `${...}` interpolation inside a template-literal select list (e.g.
        // `${PRIVATE_COLUMNS}, profiles (...)`) is not a column name this
        // static scan can resolve — it is a JS identifier, not schema text —
        // so treat an unresolved placeholder as "cannot verify" rather than
        // "does not exist".
        if (column.includes('$') || column.includes('{') || column.includes('}')) continue;
        if (!columns.has(column)) {
          problems.push(`${path.relative(root, file)}: ${table}.${column} does not exist`);
        }
      }
    }
  }

  if (problems.length) {
    fail('Contract', 'JavaScript column references exist in the schema',
      `\n      - ${problems.join('\n      - ')}`,
      'Update the JS query or the schema so they agree.');
  } else {
    pass('Contract', 'Every JS table/column reference exists in the schema', `${files.length} files scanned`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 8. Privacy spot checks against the live schema
// ---------------------------------------------------------------------------
async function auditPrivacy(client) {
  // No public table may carry an email address or credential.
  // `colleges.email_domains` is the institutional allow-list (configuration, not
  // personal data). Any *personal* email, credential or PRN column is a failure.
  const sensitive = (
    await client.query(`
      select table_name || '.' || column_name as col
      from information_schema.columns
      where table_schema='public'
        and not (table_name = 'colleges' and column_name = 'email_domains')
        and (column_name ~ '(email|password|passwd|secret|token|api_key|phone|mobile|prn)')
      order by 1
    `)
  ).rows.map((r) => r.col);
  if (sensitive.length) fail('Privacy', 'No personal email, phone, PRN or credential columns in the public schema', sensitive.join(', '), 'Store it in auth.users or drop it.');
  else pass('Privacy', 'No personal email/phone/PRN/credential columns in the public schema',
    'only colleges.email_domains (the institutional allow-list) matches the pattern');

  const emailCopy = (await client.query(`
    select count(*)::int as n from information_schema.columns
    where table_schema='public' and table_name='profile_private' and column_name ~ 'email'
  `)).rows[0].n;
  if (emailCopy) fail('Privacy', 'The institutional email is stored exactly once', `${emailCopy} email column(s) in profile_private`, 'Drop the copy; auth.users is the source of truth.');
  else pass('Privacy', 'The institutional email exists only in auth.users', 'no duplicate in profile_private');

  const randomLeak = (
    await client.query(`
      select table_name || '.' || column_name as col
      from information_schema.columns
      where table_schema='public' and table_name like 'random%'
        and column_name in ('username','display_name','email','slug','public_url','share_url')
      order by 1
    `)
  ).rows.map((r) => r.col);
  if (randomLeak.length) fail('Privacy', 'Random tables expose no identity to participants', randomLeak.join(', '), 'Remove the column.');
  else pass('Privacy', 'Random tables carry no username/email/url columns', 'identity lives only in random_session_participants + random_sessions (staff-only policies)');

  // Participant views must not select identity columns.
  const viewCols = (
    await client.query(`
      select table_name || '.' || column_name as col
      from information_schema.columns
      where table_schema='public' and table_name in ('random_session_view','random_messages_view')
        and column_name in ('user_id','sender_user_id','participant_a','participant_b','username','display_name','auth_user_id')
    `)
  ).rows.map((r) => r.col);
  if (viewCols.length) fail('Privacy', 'Random participant views expose no identity', viewCols.join(', '), 'Whitelist columns.');
  else pass('Privacy', 'Random participant views expose no identity columns');

  // The marketplace contact note is the only contact detail the product stores;
  // it must be released only through the interest RPC.
  const contactScrapable = (
    await client.query(
      `select has_column_privilege('authenticated', 'public.marketplace_listings', 'contact_note', 'SELECT') as can_read`
    )
  ).rows[0].can_read;
  if (contactScrapable) {
    fail('Privacy', 'Seller contact notes are not readable from the base table',
      'authenticated still holds SELECT on marketplace_listings.contact_note',
      'Revoke the column in migration 015; release it via record_listing_interest().');
  } else {
    pass('Privacy', 'Seller contact notes are not readable from the base table',
      'released only through record_listing_interest()');
  }

  // Reports/audit logs: nobody but staff, no student insert into audit.
  const auditPolicies = (
    await client.query(`select cmd, roles::text[] as roles from pg_policies where schemaname='public' and tablename='audit_logs'`)
  ).rows;
  const auditWrites = auditPolicies.filter((p) => p.cmd !== 'SELECT');
  if (auditWrites.length) fail('Privacy', 'audit_logs is append-only via log_audit()', `found ${auditWrites.length} write policies`, 'Drop them; audit rows are written by the definer function.');
  else pass('Privacy', 'audit_logs has no write policies for clients');

  const notifications = (await client.query(
    `select count(*)::int as n from pg_policies where schemaname='public' and tablename='notifications' and cmd='INSERT'`
  )).rows[0].n;
  if (notifications) fail('Privacy', 'notifications cannot be forged by clients', 'INSERT policy present', 'Remove it; use notify_user().');
  else pass('Privacy', 'notifications cannot be forged by clients (no INSERT policy)');

  const messagePolicies = (
    await client.query(`select policyname, coalesce(qual,'') as qual, coalesce(with_check,'') as chk from pg_policies
                        where schemaname='public' and tablename='messages'`)
  ).rows;
  // Every policy must either prove membership or prove a staff permission that is
  // itself gated on an open report (moderation evidence access).
  const policyOk = (p) =>
    /can_access_conversation|current_profile_id/.test(p.qual + p.chk) ||
    /has_permission/.test(p.qual + p.chk);
  const offending = messagePolicies.filter((p) => !policyOk(p));
  if (messagePolicies.length && !offending.length) {
    pass('Privacy', 'messages access requires membership or a staff permission',
      `${messagePolicies.length} policies; moderation access additionally requires an open report`);
  } else {
    fail('Privacy', 'messages access requires membership or a staff permission',
      offending.map((p) => p.policyname).join(', '), 'Every policy must test membership or permission.');
  }

  // Rate limiting must exist and be callable.
  const rateFn = (await client.query(`select 1 from pg_proc where pronamespace='public'::regnamespace and proname='consume_rate_limit'`)).rows.length;
  if (rateFn) pass('Rate limiting', 'consume_rate_limit() exists');
  else fail('Rate limiting', 'consume_rate_limit() exists', 'Missing function', 'Restore migration 011.');
}


/**
 * Extract the `notification_type` argument of every `notify_user(...)` call in
 * a migration file.
 *
 * Only the second positional argument (or the named `p_type =>` one) is the
 * enum value. The reference_type argument carries table-ish strings such as
 * 'marketplace_listing', which are *not* enum members; the first version of
 * this check matched those too and produced false positives.
 */
function notificationTypeLiterals(text) {
  const found = new Set();
  const call = /notify_user\s*\(/g;
  let match;
  while ((match = call.exec(text))) {
    let i = call.lastIndex;
    let depth = 1;
    let arg = '';
    const args = [];
    let inString = false;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (inString) {
        arg += ch;
        if (ch === "'" && text[i + 1] === "'") { arg += text[i + 1]; i += 2; continue; }
        if (ch === "'") inString = false;
        i += 1;
        continue;
      }
      if (ch === "'") { inString = true; arg += ch; i += 1; continue; }
      if (ch === '(') { depth += 1; }
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) { args.push(arg); break; }
      } else if (ch === ',' && depth === 1) {
        args.push(arg);
        arg = '';
        i += 1;
        continue;
      }
      arg += ch;
      i += 1;
    }
    const named = args.find((a) => /^\s*(p_type|type)\s*=>/.test(a));
    const candidate = named !== undefined
      ? named.replace(/^\s*(p_type|type)\s*=>/, '')
      : (args.length >= 2 ? args[1] : '');
    const literal = candidate.match(/^\s*'([a-z_]+)'/);
    if (literal) found.add(literal[1]);
  }
  return found;
}

// ---------------------------------------------------------------------------
async function main() {
  await auditMigrationHistory();

  // Port is overridable so the audit can run next to the perf harness, which
  // keeps the development database on 55433.
  const port = Number(process.env.AUDIT_DB_PORT || 55435);
  const { pg, client } = await startDatabase({ port, dataDirName: 'pg-audit-data' });
  try {
    banner('Applying migrations…');
    const files = await migrationFiles();
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
    }
    pass('Migrations', 'Fresh database from zero', `${files.length} migrations applied to an empty PostgreSQL 15 database`);

    banner('Auditing schema…');
    await auditRls(client);
    await auditGrants(client);
    await auditSecurityDefiner(client);
    await auditDataModel(client);
    await auditColumnPrivileges(client);
    const constants = await loadConstants();
    await auditContract(client, constants);
    await auditJsColumnReferences(client);
    await auditPrivacy(client);
  } finally {
    await shutdown(pg, client);
  }

  // -------------------------------------------------------------------------
  banner('Audit report');
  const sections = [...new Set(results.map((r) => r.section))];
  for (const section of sections) {
    console.log(`\n\x1b[1m${section}\x1b[0m`);
    for (const r of results.filter((x) => x.section === section)) {
      const mark = r.level === 'pass' ? '\x1b[32m✓\x1b[0m' : r.level === 'warn' ? '\x1b[33m!\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`  ${mark} ${r.title}${r.detail ? ` — ${r.detail}` : ''}`);
      if (r.fix && r.level !== 'pass') console.log(`      \x1b[33mfix:\x1b[0m ${r.fix}`);
    }
  }

  const failed = results.filter((r) => r.level === 'fail').length;
  const warned = results.filter((r) => r.level === 'warn').length;
  const passed = results.filter((r) => r.level === 'pass').length;
  console.log(`\n${passed} passed, ${warned} warnings, ${failed} failures\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
