import { Prisma } from '@prisma/client';
import { RFM_DEFINITIONS } from '../../../../../ai-engine/tools/domains/customers.tools';
import {
  CRM_CONSENT_VALUES,
  CRM_CUSTOMER_SOURCES,
} from '../profile/dto/customer-crm.dto';

/**
 * Segment filter v1 (PLAN-CRM §4.5): a closed catalog of fields and
 * operators. A filter is parsed into a validated tree first and only then
 * compiled; every SQL fragment below is a fixed string of this file and every
 * user value travels as a bound parameter. No field, operator, column or SQL
 * text ever comes from the payload.
 *
 * Fields: `tag`, `rfm`, `orders_count`, `total_spent`, `last_order_at`,
 * `source`, `stage`, `owner`, `created_at`, `consent.<channel>` and
 * `meta.<field_key>` (customer custom fields of `entity_metadata_fields`).
 */
export const SEGMENT_FILTER_VERSION = 1;
export const SEGMENT_MAX_RULES = 20;
export const SEGMENT_MAX_DEPTH = 3;
const MAX_LIST_VALUES = 50;
const MAX_TEXT_LENGTH = 200;
const MAX_DAYS = 3650;
const MAX_AMOUNT = 1_000_000_000_000;

export const SEGMENT_OPERATORS = [
  'eq',
  'neq',
  'in',
  'gte',
  'lte',
  'between',
  'exists',
  'within_days',
  'older_than_days',
] as const;
export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number];

type ValueKind = 'id' | 'int' | 'amount' | 'date' | 'text' | 'bool' | 'enum';

interface FieldSpec {
  kind: ValueKind;
  operators: readonly SegmentOperator[];
  /** Allowed values for `enum` fields. */
  values?: readonly string[];
}

const ID_OPS = ['eq', 'neq', 'in', 'exists'] as const;
const ENUM_OPS = ['eq', 'neq', 'in'] as const;
const NUMBER_OPS = ['eq', 'neq', 'gte', 'lte', 'between'] as const;
const DATE_OPS = [
  'gte',
  'lte',
  'between',
  'within_days',
  'older_than_days',
] as const;

export const RFM_SEGMENTS = Object.keys(RFM_DEFINITIONS);
export const CONSENT_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

const FIELDS: Record<string, FieldSpec> = {
  tag: { kind: 'id', operators: ID_OPS },
  stage: { kind: 'id', operators: ID_OPS },
  owner: { kind: 'id', operators: ID_OPS },
  source: {
    kind: 'enum',
    operators: [...ENUM_OPS, 'exists'],
    values: CRM_CUSTOMER_SOURCES,
  },
  rfm: { kind: 'enum', operators: ENUM_OPS, values: RFM_SEGMENTS },
  orders_count: { kind: 'int', operators: NUMBER_OPS },
  total_spent: { kind: 'amount', operators: ['gte', 'lte', 'between'] },
  last_order_at: { kind: 'date', operators: [...DATE_OPS, 'exists'] },
  created_at: { kind: 'date', operators: DATE_OPS },
  'consent.whatsapp': {
    kind: 'enum',
    operators: ENUM_OPS,
    values: CRM_CONSENT_VALUES,
  },
  'consent.sms': { kind: 'enum', operators: ENUM_OPS, values: CRM_CONSENT_VALUES },
  'consent.email': {
    kind: 'enum',
    operators: ENUM_OPS,
    values: CRM_CONSENT_VALUES,
  },
};

/** `entity_metadata_fields.field_type` → how its value is compared. */
const META_SPECS: Record<string, FieldSpec & { column: MetaColumn }> = {
  text: { kind: 'text', operators: [...ENUM_OPS, 'exists'], column: 'text' },
  textarea: { kind: 'text', operators: ['exists'], column: 'text' },
  email: { kind: 'text', operators: [...ENUM_OPS, 'exists'], column: 'text' },
  select: { kind: 'text', operators: [...ENUM_OPS, 'exists'], column: 'text' },
  number: { kind: 'amount', operators: [...NUMBER_OPS, 'exists'], column: 'number' },
  date: { kind: 'date', operators: [...DATE_OPS, 'exists'], column: 'date' },
  checkbox: { kind: 'bool', operators: ['eq', 'exists'], column: 'bool' },
  file: { kind: 'bool', operators: ['exists'], column: 'text' },
};
type MetaColumn = 'text' | 'number' | 'date' | 'bool';

const META_KEY_PATTERN = /^[a-z0-9_]{1,100}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type SegmentValue =
  | number
  | string
  | boolean
  | number[]
  | string[]
  | [number, number]
  | [string, string];

export interface SegmentRule {
  field: string;
  cmp: SegmentOperator;
  value: SegmentValue;
}

export interface SegmentGroup {
  op: 'and' | 'or';
  rules: Array<SegmentRule | SegmentGroup>;
}

/** A field the parser accepted and the service must resolve against the store. */
export interface SegmentRequirements {
  tag_ids: number[];
  stage_ids: number[];
  owner_ids: number[];
  meta_keys: string[];
  rfm_segments: string[];
}

export interface MetaFieldRef {
  id: number;
  field_type: string;
}

export interface SegmentCompileContext {
  store_id: number;
  now: Date;
  /** IANA timezone of the store; date-only rules are store-local days. */
  timezone: string;
  /** Active customer custom fields of the store, by `field_key`. */
  meta_fields: Map<string, MetaFieldRef>;
  /** Customer ids of each RFM segment requested by the filter. */
  rfm_members: Map<string, number[]>;
}

export class SegmentFilterError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
  }
}

/**
 * Validates the raw JSON of a filter and returns a normalized copy. Anything
 * outside the catalog is rejected (never ignored), so a saved segment always
 * means exactly what its owner saw in the preview.
 */
export function parseSegmentFilter(raw: unknown): SegmentGroup {
  const counter = { rules: 0 };
  const group = parseGroup(raw, 'filter', 1, counter);
  if (counter.rules === 0) {
    throw new SegmentFilterError('El segmento necesita al menos una regla', 'filter.rules');
  }
  return group;
}

function parseGroup(
  raw: unknown,
  path: string,
  depth: number,
  counter: { rules: number },
): SegmentGroup {
  if (!isPlainObject(raw)) {
    throw new SegmentFilterError('Se esperaba un grupo {op, rules}', path);
  }
  assertKeys(raw, ['op', 'rules'], path);
  const op = raw.op;
  if (op !== 'and' && op !== 'or') {
    throw new SegmentFilterError('op debe ser "and" u "or"', `${path}.op`);
  }
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    throw new SegmentFilterError('rules debe ser una lista no vacía', `${path}.rules`);
  }
  const rules = raw.rules.map((item, index) => {
    const itemPath = `${path}.rules[${index}]`;
    if (isPlainObject(item) && 'rules' in item) {
      if (depth >= SEGMENT_MAX_DEPTH) {
        throw new SegmentFilterError(
          `Máximo ${SEGMENT_MAX_DEPTH} niveles de grupos`,
          itemPath,
        );
      }
      return parseGroup(item, itemPath, depth + 1, counter);
    }
    counter.rules += 1;
    if (counter.rules > SEGMENT_MAX_RULES) {
      throw new SegmentFilterError(
        `Máximo ${SEGMENT_MAX_RULES} reglas por segmento`,
        itemPath,
      );
    }
    return parseRule(item, itemPath);
  });
  return { op, rules };
}

function parseRule(raw: unknown, path: string): SegmentRule {
  if (!isPlainObject(raw)) {
    throw new SegmentFilterError('Se esperaba una regla {field, cmp, value}', path);
  }
  assertKeys(raw, ['field', 'cmp', 'value'], path);
  const field = raw.field;
  if (typeof field !== 'string') {
    throw new SegmentFilterError('field debe ser texto', `${path}.field`);
  }
  const cmp = raw.cmp;
  if (field.startsWith('meta.')) {
    // The real type is only known once the store field is resolved: check the
    // shape here and the value in `compileSegmentFilter`.
    if (!META_KEY_PATTERN.test(field.slice(5))) {
      throw new SegmentFilterError('Clave de campo personalizado inválida', `${path}.field`);
    }
    if (typeof cmp !== 'string' || !(SEGMENT_OPERATORS as readonly string[]).includes(cmp)) {
      throw new SegmentFilterError('Operador no permitido', `${path}.cmp`);
    }
    return { field, cmp: cmp as SegmentOperator, value: rawMetaValue(raw.value, `${path}.value`) };
  }
  const spec = FIELDS[field];
  if (!spec) {
    throw new SegmentFilterError(`Campo no permitido: ${field}`, `${path}.field`);
  }
  if (
    typeof cmp !== 'string' ||
    !(spec.operators as readonly string[]).includes(cmp)
  ) {
    throw new SegmentFilterError(
      `Operador no permitido para ${field}; usa: ${spec.operators.join(', ')}`,
      `${path}.cmp`,
    );
  }
  const value = parseValue(spec, cmp as SegmentOperator, raw.value, `${path}.value`);
  return { field, cmp: cmp as SegmentOperator, value };
}

/** A primitive or a short list of primitives; typed later against the field. */
function rawMetaValue(value: unknown, path: string): SegmentValue {
  const primitive = (item: unknown) =>
    typeof item === 'boolean' ||
    (typeof item === 'number' && Number.isFinite(item)) ||
    (typeof item === 'string' && item.length <= MAX_TEXT_LENGTH);
  if (primitive(value)) return value as SegmentValue;
  if (Array.isArray(value) && value.length <= MAX_LIST_VALUES && value.every(primitive)) {
    return value as SegmentValue;
  }
  throw new SegmentFilterError('Valor no permitido', path);
}

function parseValue(
  spec: FieldSpec,
  cmp: SegmentOperator,
  value: unknown,
  path: string,
): SegmentValue {
  if (cmp === 'exists') {
    if (typeof value !== 'boolean') {
      throw new SegmentFilterError('exists espera true o false', path);
    }
    return value;
  }
  if (cmp === 'within_days' || cmp === 'older_than_days') {
    return parseScalar('int', value, path, { min: 1, max: MAX_DAYS }) as number;
  }
  if (cmp === 'in') {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LIST_VALUES) {
      throw new SegmentFilterError(
        `in espera una lista de 1 a ${MAX_LIST_VALUES} valores`,
        path,
      );
    }
    const items = value.map((item, index) =>
      parseScalar(spec.kind, item, `${path}[${index}]`, {}, spec.values),
    );
    return [...new Set(items)] as number[] | string[];
  }
  if (cmp === 'between') {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new SegmentFilterError('between espera [desde, hasta]', path);
    }
    const from = parseScalar(spec.kind, value[0], `${path}[0]`, {});
    const to = parseScalar(spec.kind, value[1], `${path}[1]`, {});
    if ((from as number | string) > (to as number | string)) {
      throw new SegmentFilterError('between: desde no puede ser mayor que hasta', path);
    }
    return [from, to] as [number, number] | [string, string];
  }
  return parseScalar(spec.kind, value, path, {}, spec.values);
}

function parseScalar(
  kind: ValueKind,
  value: unknown,
  path: string,
  bounds: { min?: number; max?: number },
  allowed?: readonly string[],
): number | string | boolean {
  switch (kind) {
    case 'id':
    case 'int': {
      const min = bounds.min ?? (kind === 'id' ? 1 : 0);
      const max = bounds.max ?? 2_147_483_647;
      if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
        throw new SegmentFilterError(`Se esperaba un entero entre ${min} y ${max}`, path);
      }
      return value as number;
    }
    case 'amount': {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        Math.abs(value) > MAX_AMOUNT
      ) {
        throw new SegmentFilterError('Se esperaba un número', path);
      }
      return value;
    }
    case 'date': {
      if (typeof value !== 'string' || !DATE_PATTERN.test(value) || !isRealDate(value)) {
        throw new SegmentFilterError('Se esperaba una fecha AAAA-MM-DD', path);
      }
      return value;
    }
    case 'bool': {
      if (typeof value !== 'boolean') {
        throw new SegmentFilterError('Se esperaba true o false', path);
      }
      return value;
    }
    case 'enum':
    case 'text': {
      if (typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT_LENGTH) {
        throw new SegmentFilterError(
          `Se esperaba un texto de 1 a ${MAX_TEXT_LENGTH} caracteres`,
          path,
        );
      }
      if (allowed && !allowed.includes(value)) {
        throw new SegmentFilterError(`Valor no permitido; usa: ${allowed.join(', ')}`, path);
      }
      return kind === 'text' ? value.trim() : value;
    }
  }
}

/** Ids, custom fields and RFM segments the service must resolve before compiling. */
export function collectSegmentRequirements(filter: SegmentGroup): SegmentRequirements {
  const req: SegmentRequirements = {
    tag_ids: [],
    stage_ids: [],
    owner_ids: [],
    meta_keys: [],
    rfm_segments: [],
  };
  const visit = (group: SegmentGroup) => {
    for (const item of group.rules) {
      if ('rules' in item) {
        visit(item);
        continue;
      }
      const values =
        item.cmp === 'exists' ? [] : Array.isArray(item.value) ? item.value : [item.value];
      if (item.field === 'tag') req.tag_ids.push(...(values as number[]));
      else if (item.field === 'stage') req.stage_ids.push(...(values as number[]));
      else if (item.field === 'owner') req.owner_ids.push(...(values as number[]));
      else if (item.field === 'rfm') req.rfm_segments.push(...(values as string[]));
      else if (item.field.startsWith('meta.')) req.meta_keys.push(item.field.slice(5));
    }
  };
  visit(filter);
  return {
    tag_ids: [...new Set(req.tag_ids)],
    stage_ids: [...new Set(req.stage_ids)],
    owner_ids: [...new Set(req.owner_ids)],
    meta_keys: [...new Set(req.meta_keys)],
    rfm_segments: [...new Set(req.rfm_segments)],
  };
}

/**
 * Compiles a parsed filter to the `WHERE` condition of
 * {@link segmentCustomersFrom}. Aliases: `su` store_users, `u` users, `os`
 * order stats of the store.
 */
export function compileSegmentFilter(
  filter: SegmentGroup,
  ctx: SegmentCompileContext,
): Prisma.Sql {
  return compileGroup(filter, ctx);
}

function compileGroup(group: SegmentGroup, ctx: SegmentCompileContext): Prisma.Sql {
  const parts = group.rules.map((item) =>
    'rules' in item ? compileGroup(item, ctx) : compileRule(item, ctx),
  );
  const glue = group.op === 'and' ? ' AND ' : ' OR ';
  return Prisma.sql`(${Prisma.join(parts, glue)})`;
}

function compileRule(rule: SegmentRule, ctx: SegmentCompileContext): Prisma.Sql {
  const { field, cmp, value } = rule;
  switch (field) {
    case 'tag':
      return tagRule(cmp, value);
    case 'stage':
      return scalarRule(Prisma.sql`su."crm_stage_id"`, cmp, value, 'int');
    case 'owner':
      return scalarRule(Prisma.sql`su."crm_owner_user_id"`, cmp, value, 'int');
    case 'source':
      return scalarRule(Prisma.sql`su."crm_source"`, cmp, value, 'text');
    case 'consent.whatsapp':
      return scalarRule(Prisma.sql`su."whatsapp_consent"::text`, cmp, value, 'text');
    case 'consent.sms':
      return scalarRule(Prisma.sql`su."sms_consent"::text`, cmp, value, 'text');
    case 'consent.email':
      return scalarRule(Prisma.sql`su."email_consent"::text`, cmp, value, 'text');
    case 'orders_count':
      return scalarRule(Prisma.sql`COALESCE(os."orders_count", 0)`, cmp, value, 'int');
    case 'total_spent':
      return scalarRule(Prisma.sql`COALESCE(os."total_spent", 0)`, cmp, value, 'numeric');
    case 'last_order_at':
      return dateRule(Prisma.sql`os."last_order_at"`, cmp, value, ctx);
    case 'created_at':
      return dateRule(Prisma.sql`su."createdAt"`, cmp, value, ctx);
    case 'rfm':
      return rfmRule(cmp, value, ctx);
    default:
      if (field.startsWith('meta.')) return metaRule(rule, ctx);
      throw new SegmentFilterError(`Campo no permitido: ${field}`, 'filter');
  }
}

type SqlType = 'int' | 'numeric' | 'text';

function cast(type: SqlType): Prisma.Sql {
  if (type === 'int') return Prisma.raw('int');
  if (type === 'numeric') return Prisma.raw('numeric');
  return Prisma.raw('text');
}

/** `column` against a scalar value; `neq` keeps NULLs, like "is not X". */
function scalarRule(
  column: Prisma.Sql,
  cmp: SegmentOperator,
  value: SegmentValue,
  type: SqlType,
): Prisma.Sql {
  const t = cast(type);
  switch (cmp) {
    case 'eq':
      return Prisma.sql`${column} = ${value}::${t}`;
    case 'neq':
      return Prisma.sql`${column} IS DISTINCT FROM ${value}::${t}`;
    case 'in':
      return Prisma.sql`${column} = ANY(${value}::${t}[])`;
    case 'gte':
      return Prisma.sql`${column} >= ${value}::${t}`;
    case 'lte':
      return Prisma.sql`${column} <= ${value}::${t}`;
    case 'between': {
      const [from, to] = value as [number, number];
      return Prisma.sql`${column} BETWEEN ${from}::${t} AND ${to}::${t}`;
    }
    case 'exists':
      return value ? Prisma.sql`${column} IS NOT NULL` : Prisma.sql`${column} IS NULL`;
    default:
      throw new SegmentFilterError(`Operador no permitido: ${cmp}`, 'filter');
  }
}

/** Date-only bounds are store-local days; relative ones count from `now`. */
function dateRule(
  column: Prisma.Sql,
  cmp: SegmentOperator,
  value: SegmentValue,
  ctx: SegmentCompileContext,
): Prisma.Sql {
  const localDay = Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.timezone})::date`;
  switch (cmp) {
    case 'gte':
      return Prisma.sql`${localDay} >= ${value}::date`;
    case 'lte':
      return Prisma.sql`${localDay} <= ${value}::date`;
    case 'between': {
      const [from, to] = value as [string, string];
      return Prisma.sql`${localDay} BETWEEN ${from}::date AND ${to}::date`;
    }
    case 'within_days':
      return Prisma.sql`${column} >= ${utcTimestamp(daysAgo(ctx.now, value as number))}`;
    case 'older_than_days':
      return Prisma.sql`${column} < ${utcTimestamp(daysAgo(ctx.now, value as number))}`;
    case 'exists':
      return value ? Prisma.sql`${column} IS NOT NULL` : Prisma.sql`${column} IS NULL`;
    default:
      throw new SegmentFilterError(`Operador no permitido: ${cmp}`, 'filter');
  }
}

/**
 * Correlated subqueries take the store from the outer `store_users` row, so a
 * rule can never read tags or custom fields of a store other than the one
 * {@link segmentCustomersFrom} is scoped to.
 */
function tagRule(cmp: SegmentOperator, value: SegmentValue): Prisma.Sql {
  const base = Prisma.sql`SELECT 1 FROM "crm_customer_tags" ct WHERE ct."store_id" = su."store_id" AND ct."customer_id" = su."user_id"`;
  switch (cmp) {
    case 'eq':
      return Prisma.sql`EXISTS (${base} AND ct."tag_id" = ${value}::int)`;
    case 'neq':
      return Prisma.sql`NOT EXISTS (${base} AND ct."tag_id" = ${value}::int)`;
    case 'in':
      return Prisma.sql`EXISTS (${base} AND ct."tag_id" = ANY(${value}::int[]))`;
    case 'exists':
      return value ? Prisma.sql`EXISTS (${base})` : Prisma.sql`NOT EXISTS (${base})`;
    default:
      throw new SegmentFilterError(`Operador no permitido: ${cmp}`, 'filter');
  }
}

/** RFM membership is computed by the shared scorer and bound as an id list. */
function rfmRule(
  cmp: SegmentOperator,
  value: SegmentValue,
  ctx: SegmentCompileContext,
): Prisma.Sql {
  const segments = Array.isArray(value) ? (value as string[]) : [value as string];
  const ids = [
    ...new Set(segments.flatMap((segment) => ctx.rfm_members.get(segment) ?? [])),
  ];
  const member = Prisma.sql`su."user_id" = ANY(${ids}::int[])`;
  return cmp === 'neq' ? Prisma.sql`NOT (${member})` : member;
}

function metaRule(rule: SegmentRule, ctx: SegmentCompileContext): Prisma.Sql {
  const key = rule.field.slice(5);
  const field = ctx.meta_fields.get(key);
  if (!field) {
    throw new SegmentFilterError(`El campo personalizado ${key} no existe`, 'filter');
  }
  const spec = META_SPECS[field.field_type];
  if (!spec || !spec.operators.includes(rule.cmp)) {
    throw new SegmentFilterError(
      `Operador no permitido para ${rule.field}${spec ? `; usa: ${spec.operators.join(', ')}` : ''}`,
      'filter',
    );
  }
  // Re-validate the value with the real type of the store field.
  const value = parseValue(spec, rule.cmp, rule.value, 'filter.value');
  const column = Prisma.raw(`emv."value_${spec.column}"`);
  const base = Prisma.sql`SELECT 1 FROM "entity_metadata_values" emv WHERE emv."store_id" = su."store_id" AND emv."entity_type" = 'customer' AND emv."entity_id" = su."user_id" AND emv."field_id" = ${field.id}::int`;

  if (rule.cmp === 'exists') {
    const present = Prisma.sql`EXISTS (${base} AND ${column} IS NOT NULL)`;
    return value ? present : Prisma.sql`NOT ${present}`;
  }
  if (rule.cmp === 'neq') {
    const condition = innerCondition(spec.column, 'eq', value, ctx);
    return Prisma.sql`NOT EXISTS (${base} AND ${condition})`;
  }
  const condition = innerCondition(spec.column, rule.cmp, value, ctx);
  return Prisma.sql`EXISTS (${base} AND ${condition})`;
}

function innerCondition(
  column: MetaColumn,
  cmp: SegmentOperator,
  value: SegmentValue,
  ctx: SegmentCompileContext,
): Prisma.Sql {
  const sqlColumn = Prisma.raw(`emv."value_${column}"`);
  if (column === 'date') {
    switch (cmp) {
      case 'gte':
        return Prisma.sql`${sqlColumn} >= ${value}::date`;
      case 'lte':
        return Prisma.sql`${sqlColumn} <= ${value}::date`;
      case 'between': {
        const [from, to] = value as [string, string];
        return Prisma.sql`${sqlColumn} BETWEEN ${from}::date AND ${to}::date`;
      }
      case 'within_days':
        return Prisma.sql`${sqlColumn} >= ${localDate(daysAgo(ctx.now, value as number), ctx.timezone)}::date`;
      case 'older_than_days':
        return Prisma.sql`${sqlColumn} < ${localDate(daysAgo(ctx.now, value as number), ctx.timezone)}::date`;
    }
  }
  if (column === 'bool') {
    return Prisma.sql`${sqlColumn} = ${value}::boolean`;
  }
  return scalarRule(sqlColumn, cmp, value, column === 'number' ? 'numeric' : 'text');
}

/**
 * `FROM … WHERE` of the store's customers, as the customer list defines them
 * (`store_users` of the store, role `customer`, not archived), with their
 * finished-order stats. `store_id` is always the request's.
 */
export function segmentCustomersFrom(storeId: number, condition: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    FROM "store_users" su
    JOIN "users" u ON u."id" = su."user_id"
    LEFT JOIN (
      SELECT o."customer_id",
             COUNT(*)::int AS "orders_count",
             COALESCE(SUM(o."grand_total"), 0) AS "total_spent",
             MAX(o."created_at") AS "last_order_at"
      FROM "orders" o
      WHERE o."store_id" = ${storeId}
        AND o."state" = 'finished'
        AND o."customer_id" IS NOT NULL
      GROUP BY o."customer_id"
    ) os ON os."customer_id" = su."user_id"
    WHERE su."store_id" = ${storeId}
      AND u."state" <> 'archived'
      AND EXISTS (
        SELECT 1 FROM "user_roles" ur
        JOIN "roles" r ON r."id" = ur."role_id"
        WHERE ur."user_id" = u."id" AND r."name" = 'customer'
      )
      AND ${condition}`;
}

/** Columns are `timestamp` holding UTC instants. */
function utcTimestamp(date: Date): Prisma.Sql {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** `YYYY-MM-DD` of `date` in `timezone`. */
function localDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isRealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowed: string[], path: string) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) {
    throw new SegmentFilterError(`Claves no permitidas: ${extra.join(', ')}`, path);
  }
}
