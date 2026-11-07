/**
 * P4.1 token engine: `{{ path.to.data | filter:arg }}`. One syntax, a closed
 * set of roots and filters, no code evaluation. The output is always plain
 * text (it goes to a PDF, never to HTML), so there is nothing to escape.
 */

export const TOKEN_ROOTS = ['store', 'instance', 'fields', 'subject', 'user', 'now', 'row'] as const;
export const TOKEN_FILTERS = ['money', 'date', 'upper', 'lower', 'number', 'words', 'default'] as const;
export type TokenFilterName = (typeof TOKEN_FILTERS)[number];

export interface TokenFilterCall {
  name: TokenFilterName;
  arg: string | null;
}

export interface TokenRef {
  path: string;
  filters: TokenFilterCall[];
}

export type TextSegment = { type: 'text'; value: string } | { type: 'token'; ref: TokenRef };

/** One token the body uses, stored with each published version. */
export interface TokenSchemaEntry {
  path: string;
  /** Required unless a `default` filter covers the gap. */
  required: boolean;
}

/** Resolved values keyed by token path (the `data_snapshot` of an emission). */
export interface TokenScope {
  values: Record<string, unknown>;
  timezone: string;
  /** ISO 4217 code of the store; `COP` renders as `$`. */
  currency: string;
  /** Row of the table being rendered (`row.*` tokens). */
  row?: Record<string, unknown>;
}

/** The text has a token this engine does not accept. */
export class TokenSyntaxError extends Error {}
/** A required token has no value in the scope. */
export class MissingTokenError extends Error {
  constructor(readonly path: string) {
    super(`Missing value for token '${path}'`);
  }
}
/** The value exists but the filter cannot format it. */
export class TokenValueError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

const TOKEN_RE = /\{\{([\s\S]*?)\}\}/g;
const PATH_RE = /^[a-z_][a-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
const MAX_TOKEN_LENGTH = 200;
/** Inherited object members are never data: a path through them is a syntax error. */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** Splits on `|` outside quotes. */
function splitPipes(source: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let current = '';
  for (const ch of source) {
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
    } else if (ch === '|') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (quote) throw new TokenSyntaxError('Comilla sin cerrar en una variable');
  parts.push(current);
  return parts.map((p) => p.trim());
}

function parseFilter(source: string): TokenFilterCall {
  const colon = source.indexOf(':');
  const name = (colon === -1 ? source : source.slice(0, colon)).trim();
  if (!(TOKEN_FILTERS as readonly string[]).includes(name)) {
    throw new TokenSyntaxError(`El filtro '${name}' no existe`);
  }
  let arg: string | null = null;
  if (colon !== -1) {
    const raw = source.slice(colon + 1).trim();
    arg = /^(['"])([\s\S]*)\1$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  return { name: name as TokenFilterName, arg };
}

export function parseToken(inner: string): TokenRef {
  if (inner.length > MAX_TOKEN_LENGTH) throw new TokenSyntaxError('Variable demasiado larga');
  const [path, ...filters] = splitPipes(inner);
  if (!path || !PATH_RE.test(path)) {
    throw new TokenSyntaxError(`La variable '${path ?? ''}' no es válida`);
  }
  const root = path.split('.')[0];
  if (!(TOKEN_ROOTS as readonly string[]).includes(root)) {
    throw new TokenSyntaxError(`La variable '${path}' no empieza con un origen válido`);
  }
  if (path.split('.').some((seg) => FORBIDDEN_SEGMENTS.has(seg))) {
    throw new TokenSyntaxError(`La variable '${path}' no es válida`);
  }
  return { path, filters: filters.map(parseFilter) };
}

/** Splits a text into literal and token segments. Throws {@link TokenSyntaxError}. */
export function parseTemplateText(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    out.push({ type: 'token', ref: parseToken(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  if (out.some((s) => s.type === 'text' && /\{\{|\}\}/.test(s.value))) {
    throw new TokenSyntaxError('Hay una variable sin cerrar ("{{" o "}}" sueltos)');
  }
  return out;
}

/** Tokens of a text, in order, without `row.*` (table row scope). */
export function tokensOf(text: string): TokenRef[] {
  return parseTemplateText(text)
    .filter((s): s is Extract<TextSegment, { type: 'token' }> => s.type === 'token')
    .map((s) => s.ref);
}

export function isRowPath(path: string): boolean {
  return path.startsWith('row.');
}

/** Merges the tokens of several texts into a de-duplicated schema. */
export function buildTokenSchema(texts: string[], extraPaths: TokenSchemaEntry[] = []): TokenSchemaEntry[] {
  const byPath = new Map<string, TokenSchemaEntry>();
  const add = (entry: TokenSchemaEntry) => {
    const prev = byPath.get(entry.path);
    byPath.set(entry.path, {
      path: entry.path,
      required: (prev?.required ?? false) || entry.required,
    });
  };
  for (const t of texts) {
    for (const ref of tokensOf(t)) {
      if (isRowPath(ref.path)) continue;
      add({ path: ref.path, required: !ref.filters.some((f) => f.name === 'default') });
    }
  }
  extraPaths.forEach(add);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function deepGet(root: unknown, segments: string[]): unknown {
  let cur: unknown = root;
  for (const s of segments) {
    if (cur === null || typeof cur !== 'object' || !hasOwn(cur, s)) return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

/** Value of `path` in the scope: exact key, else the longest known prefix then a deep walk. */
export function lookup(scope: TokenScope, path: string): unknown {
  if (isRowPath(path)) return deepGet(scope.row, path.split('.').slice(1));
  if (hasOwn(scope.values, path)) return scope.values[path];
  const parts = path.split('.');
  for (let n = parts.length - 1; n >= 1; n--) {
    const prefix = parts.slice(0, n).join('.');
    if (hasOwn(scope.values, prefix)) return deepGet(scope.values[prefix], parts.slice(n));
  }
  return undefined;
}

export function hasValue(scope: TokenScope, path: string): boolean {
  return !isMissing(lookup(scope, path));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function toNumber(path: string, v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/\s/g, ''));
  if (!Number.isFinite(n)) throw new TokenValueError(path, 'no es un número');
  return n;
}

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** `2500000.5` → `2.500.000,5`; at most two decimals, none when whole. */
export function formatNumber(n: number): string {
  const rounded = Math.round(Math.abs(n) * 100) / 100;
  const [int, dec] = rounded.toFixed(2).split('.');
  const body = groupThousands(int) + (dec === '00' ? '' : `,${dec.replace(/0$/, '')}`);
  return n < 0 && rounded !== 0 ? `-${body}` : body;
}

export function formatMoney(n: number, currency: string): string {
  const symbol = currency === 'COP' ? '$' : `${currency} `;
  const body = formatNumber(Math.abs(n));
  return n < 0 && body !== '0' ? `-${symbol}${body}` : `${symbol}${body}`;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function datePartsInZone(path: string, v: unknown, timeZone: string): DateParts {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
    const [year, month, day] = v.trim().split('-').map(Number);
    return { year, month, day };
  }
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new TokenValueError(path, 'no es una fecha');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function formatDate(path: string, v: unknown, timeZone: string, style: string | null): string {
  const { year, month, day } = datePartsInZone(path, v, timeZone);
  if (style === null || style === '' || style === 'corto') {
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  }
  if (style === 'largo') return `${day} de ${MONTHS[month - 1]} de ${year}`;
  throw new TokenValueError(path, `el formato de fecha '${style}' no existe (usa 'largo' o ninguno)`);
}

const UNITS = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis',
  'veintisiete', 'veintiocho', 'veintinueve',
];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos',
  'setecientos', 'ochocientos', 'novecientos',
];

/** 0..999; `apocope` turns a final "uno" into "un" (before "mil"/"millones"). */
function below1000(n: number, apocope: boolean): string {
  if (n === 100) return 'cien';
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(HUNDREDS[h]);
  if (rest > 0 || h === 0) {
    let w: string;
    if (rest < 30) {
      w = UNITS[rest];
    } else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      w = u === 0 ? TENS[t] : `${TENS[t]} y ${UNITS[u]}`;
    }
    if (apocope) w = w.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
    parts.push(w);
  }
  return parts.join(' ');
}

function wordsInt(n: number, apocope: boolean): string {
  if (n < 1000) return below1000(n, apocope);
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000);
    const rest = n % 1000;
    const head = th === 1 ? 'mil' : `${below1000(th, true)} mil`;
    return rest ? `${head} ${below1000(rest, apocope)}` : head;
  }
  const m = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  const head = m === 1 ? 'un millón' : `${wordsInt(m, true)} millones`;
  return rest ? `${head} ${wordsInt(rest, apocope)}` : head;
}

/** 2500000 → "dos millones quinientos mil"; cents become "con 50/100". */
export function numberToSpanishWords(path: string, n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) throw new TokenValueError(path, 'es demasiado grande para escribirlo en letras');
  const totalCents = Math.round(abs * 100);
  const int = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  const text = wordsInt(int, false) + (cents > 0 ? ` con ${String(cents).padStart(2, '0')}/100` : '');
  return n < 0 && (int > 0 || cents > 0) ? `menos ${text}` : text;
}

function applyFilter(path: string, v: unknown, f: TokenFilterCall, scope: TokenScope): string {
  switch (f.name) {
    case 'money':
      return formatMoney(toNumber(path, v), scope.currency);
    case 'number':
      return formatNumber(toNumber(path, v));
    case 'words':
      return numberToSpanishWords(path, toNumber(path, v));
    case 'date':
      return formatDate(path, v, scope.timezone, f.arg);
    case 'upper':
      return stringify(v).toLocaleUpperCase('es-CO');
    case 'lower':
      return stringify(v).toLocaleLowerCase('es-CO');
    default:
      return stringify(v);
  }
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

/** Value of one token after its filters. Throws {@link MissingTokenError} / {@link TokenValueError}. */
export function renderToken(ref: TokenRef, scope: TokenScope): string {
  const fallback = ref.filters.find((f) => f.name === 'default');
  const raw = lookup(scope, ref.path);
  if (isMissing(raw)) {
    if (fallback) return fallback.arg ?? '';
    throw new MissingTokenError(ref.path);
  }
  let out: unknown = raw;
  for (const f of ref.filters) {
    if (f.name === 'default') continue;
    out = applyFilter(ref.path, out, f, scope);
  }
  return stringify(out);
}

/** Text with every token replaced. */
export function renderText(text: string, scope: TokenScope): string {
  return parseTemplateText(text)
    .map((s) => (s.type === 'text' ? s.value : renderToken(s.ref, scope)))
    .join('');
}

/** Required schema paths without a value in the scope. */
export function missingPaths(schema: TokenSchemaEntry[], scope: TokenScope): string[] {
  return schema.filter((e) => e.required && !hasValue(scope, e.path)).map((e) => e.path);
}
