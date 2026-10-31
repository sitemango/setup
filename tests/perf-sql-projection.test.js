import { describe, expect, it } from 'vitest';
import { buildProjection } from '@/scripts/dev/perf/sql.mjs';

const catalog = {
  fks: [{
    name: 'blocks_blocked_id_fkey',
    base_schema: 'public',
    base_table: 'blocks',
    base_column: 'blocked_id',
    foreign_schema: 'public',
    foreign_table: 'profiles',
    foreign_column: 'id',
  }],
  columns: new Map([
    ['public.blocks', new Set(['id', 'blocked_id', 'created_at'])],
    ['public.profiles', new Set(['id', 'username', 'display_name'])],
  ]),
  functions: new Map(),
};

function projection(select) {
  return buildProjection(catalog, 'blocks', select, {
    searchParams: new URLSearchParams(),
    params: [],
  });
}

describe('disposable PostgREST embed projections', () => {
  it('separates an output alias from the related table and FK hint', () => {
    const sql = projection('blocked:profiles!blocks_blocked_id_fkey ( id, username )');
    expect(sql).toContain('from public."profiles" as rel_1');
    expect(sql).toContain('rel_1."id" = base."blocked_id"');
    expect(sql).toContain('as "blocked"');
    expect(sql).not.toContain('public."blocked"');
  });

  it('keeps an unaliased resource name when an FK hint is present', () => {
    const sql = projection('profiles!blocks_blocked_id_fkey ( id )');
    expect(sql).toContain('from public."profiles" as rel_1');
    expect(sql).toContain('as "profiles"');
  });

  it('retains an ordinary unaliased embed without a hint', () => {
    const sql = projection('profiles ( display_name )');
    expect(sql).toContain('from public."profiles" as rel_1');
    expect(sql).toContain('rel_1."display_name" as "display_name"');
    expect(sql).toContain('as "profiles"');
  });
});
