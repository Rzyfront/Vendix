import { createHash } from 'node:crypto';

/** Independent H kill switch: never enables durable objectives or provider features. */
export const toolResultCompactionEnabled = (): boolean =>
  process.env.AI_TOOL_RESULT_COMPACTION_ENABLED === 'true';

export const ARTIFACT_PAGE_JSON_CHARS = 4400;
const MAX_TEXT_CHARS = 3000;
const MAX_ROWS = 500;
const FORBIDDEN_FIELDS = new Set(['__proto__', 'constructor', 'prototype']);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const integer = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number =>
  Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.trunc(value!)))
    : fallback;

interface Dataset {
  rows: unknown[];
  replace: (rows: unknown[]) => unknown;
}

/** Only recognized transport/data envelopes; never arbitrary user-controlled paths. */
function datasetOf(value: unknown, depth = 0): Dataset | null {
  if (Array.isArray(value)) return { rows: value, replace: (rows) => rows };
  if (!record(value) || depth >= 4) return null;
  for (const key of ['rows', 'items', 'results', 'data', 'body', 'response']) {
    const found = datasetOf(value[key], depth + 1);
    if (found)
      return {
        rows: found.rows,
        replace: (rows) => ({ ...value, [key]: found.replace(rows) }),
      };
  }
  return null;
}

function sourceUnits(value: unknown, depth = 0): Record<string, unknown> {
  if (!record(value) || depth > 4) return {};
  const units: Record<string, unknown> = {};
  for (const field of ['unit', 'currency', 'timezone']) {
    if (typeof value[field] === 'string' && value[field].length <= 64)
      units[field] = value[field];
  }
  if (record(value.units)) {
    const fields = Object.entries(value.units)
      .filter(
        ([key, unit]) =>
          fieldName(key) && typeof unit === 'string' && unit.length <= 64,
      )
      .slice(0, 16);
    if (fields.length) units.fields = Object.fromEntries(fields);
  }
  for (const key of ['data', 'body', 'response']) {
    const nested = sourceUnits(value[key], depth + 1);
    for (const [field, unit] of Object.entries(nested))
      if (!(field in units)) units[field] = unit;
  }
  return units;
}

export interface ArtifactAggregate {
  field: string;
  function: 'sum' | 'avg' | 'count' | 'min' | 'max';
}

export interface ArtifactPageOptions {
  offset?: number;
  limit?: number;
  cursor?: string;
  text_offset?: number;
  text_limit?: number;
  columns?: string[];
  aggregate?: ArtifactAggregate;
  /** Render blocks store units beside their rows, not inside each row. */
  source_units?: unknown;
  max_json_chars?: number;
  /** Include actual outer transport metadata when enforcing the serialized budget. */
  envelope?: (page: ArtifactPage) => unknown;
}

export interface ArtifactPage {
  artifact: true;
  bounded: true;
  reusable_for_write: false;
  format: 'rows' | 'text' | 'aggregate';
  data?: unknown;
  text?: string;
  encoding?: 'json' | 'text';
  total: number;
  offset: number;
  returned: number;
  has_more: boolean;
  cursor: string | null;
  next_offset: number | null;
  /** True only if THIS response includes the entire saved payload, not just its last page. */
  complete: boolean;
  units: {
    pagination: 'records' | 'utf16_code_units';
    value?: string;
    [key: string]: unknown;
  };
  total_chars?: number;
  columns?: string[];
  aggregate?: ArtifactAggregate;
  matched_records?: number;
}

interface PageCursor {
  v: 1;
  h: string;
  q: string;
  m: 'rows' | 'text';
  o: number;
}

function fieldName(field: string): boolean {
  return (
    /^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/.test(field) && !FORBIDDEN_FIELDS.has(field)
  );
}

function columnsOf(columns: string[] | undefined): string[] | undefined {
  if (columns === undefined) return undefined;
  if (
    !Array.isArray(columns) ||
    !columns.length ||
    columns.length > 32 ||
    columns.some((field) => typeof field !== 'string' || !fieldName(field))
  )
    throw new Error('Invalid artifact columns');
  return [...new Set(columns)];
}

function decodeCursor(
  cursor: string,
  contentHash: string,
  queryHash: string,
): PageCursor {
  try {
    if (cursor.length > 400 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw new Error();
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as PageCursor;
    if (
      parsed.v !== 1 ||
      parsed.h !== contentHash ||
      parsed.q !== queryHash ||
      !['rows', 'text'].includes(parsed.m) ||
      !Number.isSafeInteger(parsed.o) ||
      parsed.o < 0
    )
      throw new Error();
    return parsed;
  } catch {
    throw new Error('Invalid artifact cursor or changed snapshot/query');
  }
}

/** Pure, idempotent and byte-independent: serialized JSON chars are a transport bound, NOT tokens. */
export function readArtifactPage(
  value: unknown,
  options: ArtifactPageOptions = {},
): ArtifactPage {
  const serialized = JSON.stringify(value) ?? 'null';
  const contentHash = hash(serialized);
  const columns = columnsOf(options.columns);
  const aggregate = options.aggregate;
  if (
    aggregate &&
    (!fieldName(aggregate.field) ||
      !['sum', 'avg', 'count', 'min', 'max'].includes(aggregate.function))
  )
    throw new Error('Invalid artifact aggregate');
  const queryHash = hash(
    JSON.stringify({ columns: columns ?? null, aggregate: aggregate ?? null }),
  );
  const savedCursor = options.cursor
    ? decodeCursor(options.cursor, contentHash, queryHash)
    : null;
  const makeCursor = (mode: 'rows' | 'text', offset: number): string =>
    Buffer.from(
      JSON.stringify({
        v: 1,
        h: contentHash,
        q: queryHash,
        m: mode,
        o: offset,
      }),
    ).toString('base64url');
  const maxChars = integer(
    options.max_json_chars,
    ARTIFACT_PAGE_JSON_CHARS,
    768,
    5500,
  );
  const fits = (page: ArtifactPage): boolean =>
    JSON.stringify(options.envelope ? options.envelope(page) : page).length <=
    maxChars;
  const base = {
    artifact: true,
    bounded: true,
    reusable_for_write: false,
  } as const;
  const found = datasetOf(value);
  const units = { ...sourceUnits(options.source_units), ...sourceUnits(value) };

  if (aggregate) {
    if (!found)
      throw new Error('Artifact aggregation requires a saved row dataset');
    if (savedCursor) throw new Error('Aggregation has no continuation cursor');
    let count = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const row of found.rows) {
      const item =
        record(row) &&
        Object.prototype.hasOwnProperty.call(row, aggregate.field)
          ? row[aggregate.field]
          : undefined;
      if (typeof item !== 'number' || !Number.isFinite(item)) continue;
      count++;
      sum += item;
      min = Math.min(min, item);
      max = Math.max(max, item);
    }
    if (aggregate.function !== 'count' && count !== found.rows.length)
      throw new Error(
        'Artifact aggregate requires finite numeric values in every row; read columns/pages instead',
      );
    const result =
      aggregate.function === 'count'
        ? found.rows.length
        : aggregate.function === 'sum'
          ? sum
          : !count
            ? null
            : aggregate.function === 'avg'
              ? sum / count
              : aggregate.function === 'min'
                ? min
                : max;
    if (result !== null && !Number.isFinite(result))
      throw new Error('Artifact aggregate numeric overflow');
    const page: ArtifactPage = {
      ...base,
      format: 'aggregate',
      data: { value: result, numeric_records: count },
      total: found.rows.length,
      offset: 0,
      returned: found.rows.length,
      has_more: false,
      cursor: null,
      next_offset: null,
      complete: true,
      units: {
        ...units,
        pagination: 'records',
        value: aggregate.function === 'count' ? 'records' : 'source_field',
      },
      aggregate,
      matched_records: found.rows.length,
    };
    if (!fits(page))
      throw new Error('Artifact response metadata exceeds page budget');
    return page;
  }

  if (found && savedCursor?.m !== 'text' && options.text_offset === undefined) {
    const offset = Math.min(
      found.rows.length,
      savedCursor?.o ?? integer(options.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    );
    const limit = integer(options.limit, 50, 1, MAX_ROWS);
    const projected = (row: unknown): unknown =>
      columns && record(row)
        ? Object.fromEntries(
            columns
              .filter((key) => Object.prototype.hasOwnProperty.call(row, key))
              .map((key) => [key, row[key]]),
          )
        : row;
    const makePage = (count: number): ArtifactPage => {
      const next = offset + count;
      const hasMore = next < found.rows.length;
      return {
        ...base,
        format: 'rows',
        data: found.replace(found.rows.slice(offset, next).map(projected)),
        total: found.rows.length,
        offset,
        returned: count,
        has_more: hasMore,
        cursor: hasMore ? makeCursor('rows', next) : null,
        next_offset: hasMore ? next : null,
        complete: offset === 0 && !hasMore,
        units: { ...units, pagination: 'records' },
        ...(columns ? { columns } : {}),
      };
    };
    let low = 0;
    let high = Math.min(limit, found.rows.length - offset);
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fits(makePage(mid))) low = mid;
      else high = mid - 1;
    }
    const count = low;
    const page = makePage(count);
    if ((count > 0 || offset === found.rows.length) && fits(page)) return page;
    // A single giant row or giant envelope metadata cannot be sliced into a fake row.
    // Start the full serialized snapshot as text once, then follow its text cursor.
    if (offset > 0)
      throw new Error(
        'Artifact row exceeds budget; restart with text_offset=0',
      );
  }

  const text = typeof value === 'string' ? value : serialized;
  const offset = Math.min(
    text.length,
    savedCursor?.o ??
      integer(
        options.text_offset ?? options.offset,
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
  );
  const limit = integer(options.text_limit, MAX_TEXT_CHARS, 1, MAX_TEXT_CHARS);
  const makeTextPage = (count: number): ArtifactPage => {
    const next = offset + count;
    const hasMore = next < text.length;
    return {
      ...base,
      format: 'text',
      text: text.slice(offset, next),
      encoding: typeof value === 'string' ? 'text' : 'json',
      total: text.length,
      total_chars: text.length,
      offset,
      returned: count,
      has_more: hasMore,
      cursor: hasMore ? makeCursor('text', next) : null,
      next_offset: hasMore ? next : null,
      complete: offset === 0 && !hasMore,
      units: { ...units, pagination: 'utf16_code_units' },
    };
  };
  let low = 0;
  let high = Math.min(limit, text.length - offset);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(makeTextPage(mid))) low = mid;
    else high = mid - 1;
  }
  const page = makeTextPage(low);
  if (!fits(page) || (page.has_more && !page.returned))
    throw new Error('Artifact response metadata exceeds page budget');
  return page;
}

export interface RecoverableResultRef {
  block_id?: string;
  artifact_ref?: { objective_id: string; result_id: string; path: string };
  evidence_refs?: string[];
}

/** Summaries are structural facts, never a prefix of untrusted prose/partial JSON. */
export function describeToolResult(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  const found = datasetOf(parsed);
  const records = [parsed, ...(found?.rows ?? []).slice(0, 32)].filter(record);
  const ids: Array<{ field: string; value: string | number }> = [];
  for (const row of records) {
    for (const [field, value] of Object.entries(row)) {
      if (
        /^(?:id|[a-z_]+_id)$/.test(field) &&
        ((typeof value === 'number' && Number.isSafeInteger(value)) ||
          (typeof value === 'string' && value.length <= 100)) &&
        ids.length < 32
      )
        ids.push({ field, value: value as string | number });
    }
  }
  const metadata = record(parsed) ? parsed : {};
  const data = record(metadata.data) ? metadata.data : {};
  const units = sourceUnits(parsed);
  const pagination = record(metadata.pagination)
    ? metadata.pagination
    : record(data.pagination)
      ? data.pagination
      : null;
  const total = found?.rows.length ?? null;
  return {
    summary:
      total === null
        ? `Saved ${typeof parsed === 'string' ? 'text' : 'JSON'} result; ${raw.length} UTF-16 code units.`
        : `Saved result containing ${total} records; full snapshot available through its reader.`,
    rows: total,
    ids,
    ids_complete: false,
    units,
    source_pagination: pagination
      ? {
          total:
            typeof pagination.total === 'number' ? pagination.total : total,
          has_more:
            typeof pagination.has_more === 'boolean'
              ? pagination.has_more
              : null,
          complete: pagination.complete === true,
          cursor:
            typeof pagination.next_cursor === 'string' ||
            typeof pagination.next_cursor === 'number'
              ? pagination.next_cursor
              : null,
        }
      : null,
  };
}

/** Reader markers are recognized only in known transport envelopes; nested business data is not authority. */
export function isBoundedArtifactPage(value: unknown, depth = 0): boolean {
  if (!record(value) || depth > 4) return false;
  if (
    value.artifact === true &&
    value.bounded === true &&
    value.reusable_for_write === false
  )
    return true;
  return ['data', 'body', 'response'].some((key) =>
    isBoundedArtifactPage(value[key], depth + 1),
  );
}

export async function compactRecoverableToolResult(
  toolName: string,
  raw: string,
  options: {
    /** Caller guarantees current tenant+user ownership and full persistence; no ref means no compaction. */
    persist: () => Promise<RecoverableResultRef | null>;
    requested_fields?: string[];
    evidence_refs?: string[];
    max_chars?: number;
  },
): Promise<string> {
  if (raw.length <= 6000) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      isBoundedArtifactPage(parsed) ||
      (record(parsed) && parsed.compaction_version === '1')
    )
      return raw;
  } catch {
    /* Plain text still has a recoverable reader. */
  }
  let ref: RecoverableResultRef | null;
  try {
    ref = await options.persist();
  } catch {
    return raw;
  }
  if (!ref?.block_id && !ref?.artifact_ref) return raw;
  const description = describeToolResult(raw);
  const fields = (options.requested_fields ?? [])
    .filter((field) => typeof field === 'string' && field.length <= 100)
    .slice(0, 32);
  const envelope = {
    compaction_version: '1',
    bounded: true,
    ...description,
    tool: toolName,
    block_id: ref.block_id ?? null,
    ...(ref.artifact_ref ? { artifact_ref: ref.artifact_ref } : {}),
    requested_fields: fields,
    requested_fields_omitted:
      (options.requested_fields?.length ?? 0) - fields.length,
    evidence_refs: [
      ...new Set([
        ...(ref.evidence_refs ?? []),
        ...(options.evidence_refs ?? []),
      ]),
    ]
      .filter((item) => typeof item === 'string' && item.length <= 256)
      .slice(0, 16),
    total: description.rows,
    has_more: true,
    cursor: null,
    complete: false,
    truncated: true,
    next_step: ref.block_id
      ? 'Read block_id with vex_block_read; follow cursor/next_offset until has_more=false. Partial text is not a JSON dataset.'
      : 'Read artifact_ref.path with call_endpoint; follow next_query/artifact_cursor until has_more=false. Historical evidence never authorizes a write.',
  };
  const maxChars = integer(options.max_chars, 4400, 1000, 5500);
  // Remove only whole optional metadata records. The saved payload is never sliced.
  while (JSON.stringify(envelope).length > maxChars && envelope.ids.length)
    envelope.ids.pop();
  while (
    JSON.stringify(envelope).length > maxChars &&
    envelope.evidence_refs.length > 1
  )
    envelope.evidence_refs.pop();
  return JSON.stringify(envelope).length <= maxChars
    ? JSON.stringify(envelope)
    : raw;
}
