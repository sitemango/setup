/**
 * PostgREST-compatible SQL translation for the local performance harness.
 *
 * The harness talks the same HTTP contract as PostgREST so the application code
 * under test is byte-for-byte the production code: it only changes the URL it
 * points at. This module turns the PostgREST query string into SQL, including
 * foreign-key embedding (`user_roles?select=roles(key)`), which the app already
 * relies on in `lib/auth/session.js` and `lib/blocks.js`.
 *
 * Unsupported syntax fails loudly instead of silently returning wrong rows.
 */

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'and', 'or']);

export class StubQueryError extends Error {
  constructor(message, { code = 'PGRST100', status = 400 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* -------------------------------------------------------------------------- */
/* Catalog                                                                     */
/* -------------------------------------------------------------------------- */

export async function loadCatalog(client) {
  const fks = (
    await client.query(`
      select c.conname as name,
             bn.nspname as base_schema, bt.relname as base_table, ba.attname as base_column,
             fn.nspname as foreign_schema, ft.relname as foreign_table, fa.attname as foreign_column
      from pg_constraint c
      join pg_class bt on bt.oid = c.conrelid
      join pg_namespace bn on bn.oid = bt.relnamespace
      join pg_class ft on ft.oid = c.confrelid
      join pg_namespace fn on fn.oid = ft.relnamespace
      join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
      join lateral unnest(c.confkey) with ordinality as f(attnum, ord) on f.ord = k.ord
      join pg_attribute ba on ba.attrelid = bt.oid and ba.attnum = k.attnum
      join pg_attribute fa on fa.attrelid = ft.oid and fa.attnum = f.attnum
      where c.contype = 'f'
    `)
  ).rows;

  const columns = new Map();
  for (const row of (
    await client.query(`
      select n.nspname as schema, c.relname as table_name, a.attname as column_name
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p') and a.attnum > 0 and not a.attisdropped
    `)
  ).rows) {
    const key = `${row.schema}.${row.table_name}`;
    if (!columns.has(key)) columns.set(key, new Set());
    columns.get(key).add(row.column_name);
  }

  const functions = new Map();
  for (const row of (
    await client.query(`
      select p.proname as name,
             p.proretset as returns_set,
             pg_catalog.format_type(p.prorettype, null) as return_type,
             coalesce(array_agg(json_build_object('name', coalesce(pa.name, ''), 'type', pg_catalog.format_type(pa.type, null))
                      order by pa.ord) filter (where pa.ord is not null), '{}') as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join lateral (
        select unnest(p.proargnames) as name, unnest(p.proargtypes) as type, generate_subscripts(p.proargtypes, 1) as ord
      ) pa on true
      where n.nspname = 'public'
      group by p.oid, p.proname, p.proretset, p.prorettype
    `)
  ).rows) {
    functions.set(row.name, { returnsSet: row.returns_set, returnType: row.return_type, args: row.args });
  }

  return { fks, columns, functions };
}

function columnExists(catalog, table, column) {
  const set = catalog.columns.get(`public.${table}`);
  if (!set) throw new StubQueryError(`Relation public.${table} is not exposed in the schema cache`);
  if (!set.has(column)) throw new StubQueryError(`Column ${table}.${column} does not exist`);
  return true;
}

function findRelationship(catalog, baseTable, relatedTable, hint = null) {
  const matches = catalog.fks.filter((fk) => {
    const forward = fk.base_table === baseTable && fk.foreign_table === relatedTable;
    const reverse = fk.base_table === relatedTable && fk.foreign_table === baseTable;
    if (!forward && !reverse) return false;
    if (hint && fk.name !== hint && !fk.name.startsWith(`${hint}_`) && !hint.startsWith(fk.name)) {
      // PostgREST also accepts `table_column_fkey` style hints.
      const expected = forward ? `${baseTable}_${fk.base_column}_fkey` : `${relatedTable}_${fk.foreign_column}_fkey`;
      if (hint !== expected) return false;
    }
    return true;
  });
  if (!matches.length) {
    throw new StubQueryError(
      `Could not find a relationship between '${baseTable}' and '${relatedTable}' in the schema cache`,
    );
  }
  const fk = matches[0];
  const forward = fk.base_table === baseTable;
  return { fk, forward };
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

const OPERATORS = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'ILIKE',
};

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function parseLogicValue(raw) {
  // PostgREST wraps logic trees in parentheses: or=(a.eq.1,b.eq.2)
  const value = raw.startsWith('(') && raw.endsWith(')') ? raw.slice(1, -1) : raw;
  const parts = [];
  let depth = 0;
  let inQuotes = false;
  let current = '';
  for (const char of value) {
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && char === '(') depth += 1;
    if (!inQuotes && char === ')') depth -= 1;
    if (!inQuotes && char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function splitValues(value) {
  const body = value.startsWith('(') && value.endsWith(')') ? value.slice(1, -1) : value;
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '"' && body[i - 1] !== '\\') {
      inQuotes = !inQuotes;
      if (!inQuotes) continue;
      continue;
    }
    if (char === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

/** Parse one `column=operator.value` comparison into a SQL fragment. */
function buildComparison(column, raw, params) {
  let negation = '';
  let operator = raw;
  if (operator.startsWith('not.')) {
    negation = 'not ';
    operator = operator.slice(4);
  }
  const dot = operator.indexOf('.');
  if (dot === -1) throw new StubQueryError(`Unknown operator in: ${raw}`);
  const op = operator.slice(0, dot);
  const value = operator.slice(dot + 1);
  const col = quoteIdent(column);

  if (op === 'is') {
    if (value === 'null') return `${col} is ${negation ? 'not ' : ''}null`;
    if (value === 'true') return `${col} is ${negation ? 'not ' : ''}true`;
    if (value === 'false') return `${col} is ${negation ? 'not ' : ''}false`;
    throw new StubQueryError(`Unsupported is.${value}`);
  }
  if (op === 'in') {
    const list = splitValues(value).map((item) => {
      params.push(item);
      return `$${params.length}`;
    });
    return `${col} ${negation}in (${list.join(', ')})`;
  }
  if (OPERATORS[op]) {
    params.push(value);
    return `${col} ${negation}${OPERATORS[op]} $${params.length}`;
  }
  if (['fts', 'plfts', 'phfts', 'wfts'].includes(op)) {
    const fn = { fts: 'to_tsquery', plfts: 'plainto_tsquery', phfts: 'phraseto_tsquery', wfts: 'websearch_to_tsquery' }[op];
    params.push(value);
    return `${negation}${col} @@ ${fn}($${params.length})`;
  }
  if (op === 'ov' || op === 'cs' || op === 'cd') {
    const sqlOp = { ov: '&&', cs: '@>', cd: '<@' }[op];
    params.push(value.includes('{') ? value : `{${value}}`);
    return `${col} ${negation}${sqlOp} $${params.length}`;
  }
  throw new StubQueryError(`Unsupported PostgREST operator: ${op}`);
}

export function buildWhere(catalog, table, searchParams, params, alias = 'base') {
  const clauses = [];
  for (const [key, raw] of searchParams.entries()) {
    if (RESERVED.has(key)) continue;
    const [rawColumn, ...rest] = key.split('.');
    const column = rawColumn;
    // Dotted keys filter an embedded resource (`notifications.read_at=is.null`).
    // Top-level filters only here; embedded filters are applied inside the embed.
    if (rest.length) continue;
    if (raw === '') throw new StubQueryError(`Missing filter value for ${key}`);
    if (raw.startsWith('or(') || raw.startsWith('and(')) throw new StubQueryError('Nested logic in filters is not supported');
    columnExists(catalog, table, column);
    clauses.push(buildComparison(column, raw, params));
  }
  const logic = searchParams.get('or');
  if (logic) {
    const parts = parseLogicValue(logic).map((part) => {
      const dot = part.indexOf('.');
      const column = part.slice(0, dot);
      const expression = part.slice(dot + 1);
      columnExists(catalog, table, column);
      return buildComparison(column, expression, params);
    });
    clauses.push(`(${parts.join(' or ')})`);
  }
  return clauses.length ? clauses.map((clause) => clause.replace(/"/g, '"')).join(' and ') : null;
}

/** Filters that apply to an embedded resource (`rel.column=eq.value`). */
function buildEmbedWhere(catalog, table, searchParams, params, prefix) {
  const local = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith(`${prefix}.`)) local.set(key.slice(prefix.length + 1), value);
  }
  if (!local.toString()) return null;
  return buildWhere(catalog, table, local, params, '');
}

/* -------------------------------------------------------------------------- */
/* Select list                                                                 */
/* -------------------------------------------------------------------------- */

function splitTopLevel(input) {
  const parts = [];
  let depth = 0;
  let current = '';
  let inQuotes = false;
  for (const char of input) {
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && char === '(') depth += 1;
    if (!inQuotes && char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Build the SQL projection list for a PostgREST `select=` expression.
 * Supports plain columns, `alias:column`, `table(columns)` and
 * `alias:table!fk_hint(columns)`.
 */
export function buildProjection(catalog, table, select, { searchParams, params, alias = 'base', depth = 0 }) {
  if (!select || select === '*') return `${alias}.*`;
  const pieces = splitTopLevel(select);
  const out = [];
  for (const piece of pieces) {
    const paren = piece.indexOf('(');
    if (paren === -1) {
      const [maybeAlias, maybeColumn] = piece.includes(':') ? piece.split(':') : [null, piece];
      const column = maybeColumn.trim();
      if (column === '*') {
        out.push(`${alias}.*`);
        continue;
      }
      const [columnName, cast] = column.split('::');
      columnExists(catalog, table, columnName);
      const castSql = cast ? `::${cast}` : '';
      out.push(`${alias}.${quoteIdent(columnName)}${castSql} as ${quoteIdent(maybeAlias || columnName)}`);
      continue;
    }
    const head = piece.slice(0, paren);
    const inner = piece.slice(paren + 1, piece.lastIndexOf(')'));
    // Split the output alias from the resource before parsing the resource's
    // relationship hint. In `blocked:profiles!blocks_blocked_id_fkey`, the
    // related table is `profiles`, not `blocked`; treating the alias as both
    // made the disposable stub reject a valid PostgREST production query.
    const colon = head.indexOf(':');
    const outputName = (colon === -1 ? head.split('!')[0] : head.slice(0, colon)).trim();
    const resource = (colon === -1 ? head : head.slice(colon + 1)).trim();
    const [targetPart, ...hintParts] = resource.split('!');
    const target = targetPart.trim();
    const fkHint = hintParts[0]?.trim() || null;
    const { fk, forward } = findRelationship(catalog, table, target, fkHint);
    // Each embed level gets its own alias so nested embeds can reference the
    // outer row without shadowing it (PostgREST does the same).
    const childAlias = `rel_${depth + 1}`;
    const innerProjection = buildProjection(catalog, target, inner, {
      searchParams,
      params,
      alias: childAlias,
      depth: depth + 1,
    });
    const embedFilters = buildEmbedWhere(catalog, target, searchParams, params, outputName);
    // Forward (many-to-one): the FK lives on the base row.
    // Reverse (one-to-many): the FK lives on the related row.
    const childColumn = forward ? fk.foreign_column : fk.base_column;
    const parentColumn = forward ? fk.base_column : fk.foreign_column;
    const join =
      `from public.${quoteIdent(target)} as ${childAlias} where ${childAlias}.${quoteIdent(childColumn)} = ${alias}.${quoteIdent(parentColumn)}` +
      (embedFilters ? ` and ${embedFilters}` : '');
    if (forward) {
      // many-to-one: at most one related row
      out.push(`(select to_jsonb(x) from (select ${innerProjection} ${join}) x) as ${quoteIdent(outputName)}`);
    } else {
      out.push(`(select coalesce(jsonb_agg(x), '[]'::jsonb) from (select ${innerProjection} ${join}) x) as ${quoteIdent(outputName)}`);
    }
  }
  return out.join(', ');
}

function buildOrder(selectTable, searchParams, catalog) {
  const order = searchParams.get('order');
  if (!order) return null;
  const clauses = order.split(',').map((entry) => {
    const [column, ...mods] = entry.trim().split('.');
    columnExists(catalog, selectTable, column);
    const ascending = !mods.includes('desc');
    const nulls = mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : '';
    return `base.${quoteIdent(column)} ${ascending ? 'asc' : 'desc'}${nulls}`;
  });
  return clauses.join(', ');
}

/* -------------------------------------------------------------------------- */
/* Statements                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * @returns {{ text: string, params: unknown[] }} one statement returning
 *   `{ data, total }` where `data` is a JSON array of rows.
 */
export function buildSelect(catalog, table, searchParams) {
  const params = [];
  const select = searchParams.get('select') || '*';
  const projection = buildProjection(catalog, table, select, { searchParams, params });
  const where = buildWhere(catalog, table, searchParams, params);
  const order = buildOrder(table, searchParams, catalog);
  const limit = searchParams.get('limit');
  const offset = searchParams.get('offset');
  const inner = [
    `select ${projection} from public.${quoteIdent(table)} as base`,
    where ? `where ${where}` : '',
    order ? `order by ${order}` : '',
    limit ? `limit ${Number(limit)}` : '',
    offset ? `offset ${Number(offset)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const countWhere = where ? `where ${where}` : '';
  const text = `select (select coalesce(jsonb_agg(r), '[]'::jsonb) from (${inner}) r) as data,
                       (select count(*)::int from public.${quoteIdent(table)} as base ${countWhere}) as total`;
  return { text, params };
}

export function buildInsert(catalog, table, searchParams, body) {
  const columnsParam = searchParams.get('columns');
  const rows = Array.isArray(body) ? body : [body];
  if (!rows.length) throw new StubQueryError('POST requires at least one row', { status: 400 });
  const columns = columnsParam
    ? columnsParam.split(',').map((c) => c.trim())
    : Object.keys(rows[0]);
  for (const column of columns) columnExists(catalog, table, column);

  const params = [];
  const values = rows
    .map((row) => {
      const tuple = columns.map((column) => {
        const value = Array.isArray(row) ? row[columns.indexOf(column)] : row[column];
        params.push(value === undefined ? null : value);
        return `$${params.length}`;
      });
      return `(${tuple.join(', ')})`;
    })
    .join(', ');
  const select = searchParams.get('select') || '*';
  const projection = buildProjection(catalog, table, select, { searchParams, params });

  const onConflict = searchParams.get('on_conflict');
  const prefer = searchParams.get('__prefer') || '';
  let conflictClause = '';
  if (onConflict) {
    const target = onConflict.split(',').map((c) => quoteIdent(c.trim())).join(', ');
    if (prefer.includes('ignore-duplicates')) conflictClause = `on conflict (${target}) do nothing`;
    else {
      const updates = columns
        .filter((column) => !onConflict.split(',').map((c) => c.trim()).includes(column))
        .map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`)
        .join(', ');
      conflictClause = `on conflict (${target}) do ${updates ? `update set ${updates}` : 'nothing'}`;
    }
  }

  const text = `with mutated as (
      insert into public.${quoteIdent(table)} as base (${columns.map(quoteIdent).join(', ')})
      values ${values}
      ${conflictClause}
      returning base.ctid as ctid
    )
    select (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
      select ${projection} from public.${quoteIdent(table)} as base join mutated on base.ctid = mutated.ctid
    ) r) as data, null::int as total`;
  return { text, params };
}

export function buildUpdate(catalog, table, searchParams, body) {
  const params = [];
  const entries = Object.entries(body);
  if (!entries.length) throw new StubQueryError('PATCH requires a body');
  for (const [column] of entries) columnExists(catalog, table, column);
  const sets = entries
    .map(([column, value]) => {
      params.push(value);
      return `${quoteIdent(column)} = $${params.length}`;
    })
    .join(', ');
  const where = buildWhere(catalog, table, searchParams, params);
  if (!where) throw new StubQueryError('PATCH without a filter is refused by the harness');
  const select = searchParams.get('select') || '*';
  const projection = buildProjection(catalog, table, select, { searchParams, params });
  const text = `with mutated as (
      update public.${quoteIdent(table)} as base set ${sets} where ${where} returning base.ctid as ctid
    )
    select (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
      select ${projection} from public.${quoteIdent(table)} as base join mutated on base.ctid = mutated.ctid
    ) r) as data, null::int as total`;
  return { text, params };
}

export function buildDelete(catalog, table, searchParams) {
  const params = [];
  const where = buildWhere(catalog, table, searchParams, params);
  if (!where) throw new StubQueryError('DELETE without a filter is refused by the harness');
  const text = `with mutated as (
      delete from public.${quoteIdent(table)} as base where ${where} returning base.ctid as ctid
    )
    select (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
      select base.* from public.${quoteIdent(table)} as base join mutated on base.ctid = mutated.ctid
    ) r) as data, null::int as total`;
  return { text, params };
}

export function buildRpc(catalog, name, args) {
  const definition = catalog.functions.get(name);
  if (!definition) throw new StubQueryError(`Could not find the function public.${name}`, { code: 'PGRST202', status: 404 });
  const params = [];
  const named = Object.entries(args || {});
  const declared = new Map(definition.args.map((arg) => [arg.name, arg.type]));
  const call = named
    .map(([key, value]) => {
      params.push(value === undefined ? null : value);
      const type = declared.get(key);
      return `${quoteIdent(key)} := $${params.length}${type ? `::${type}` : ''}`;
    })
    .join(', ');
  const invocation = `public.${quoteIdent(name)}(${call})`;
  const text = definition.returnsSet
    ? `select (select coalesce(jsonb_agg(r), '[]'::jsonb) from (select * from ${invocation}) r) as data, null::int as total`
    : `select to_jsonb(${invocation}) as data, null::int as total`;
  return { text, params, returnsSet: definition.returnsSet };
}
