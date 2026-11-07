import { createHash } from 'crypto';
import {
  TokenSchemaEntry,
  TokenSyntaxError,
  buildTokenSchema,
  parseTemplateText,
} from './template-tokens';

/** P4.1/P4.5 template bodies: typed, bounded and validated before they are stored. */

export const PAGE_SIZES = ['A4', 'LETTER'] as const;
export type PageSizeName = (typeof PAGE_SIZES)[number];
export const ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export type BlockAlign = (typeof ALIGNS)[number];

export interface SignatureSlot {
  key: string;
  role_label: string;
}

export type Block =
  | { type: 'heading'; text: string; level: 1 | 2 | 3; align?: BlockAlign }
  | { type: 'paragraph'; text: string; align?: BlockAlign }
  | { type: 'fields'; rows: Array<{ label: string; value: string }> }
  | {
      type: 'table';
      /** Path of a list, e.g. `fields.items`; each column reads `row.*`. */
      source: string;
      columns: Array<{ header: string; value: string }>;
    }
  | { type: 'image'; source: 'store.logo'; width?: number }
  | { type: 'spacer'; height: number }
  | { type: 'page_break' }
  | { type: 'signature'; slot_key: string };

export interface BlocksBody {
  page: { size: PageSizeName; margin?: number };
  header?: { show_logo?: boolean; text?: string };
  footer?: { text?: string; page_numbers?: boolean };
  blocks: Block[];
  signature_slots?: SignatureSlot[];
}

export interface BasePdfField {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
  font_size?: number;
  align?: BlockAlign;
}

export interface BasePdfSlot extends SignatureSlot {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BasePdfBody {
  fields: BasePdfField[];
  signature_slots: BasePdfSlot[];
}

export const LIMITS = {
  blocks: 200,
  text: 5000,
  short: 200,
  rows: 50,
  columns: 8,
  slots: 6,
  baseFields: 100,
  basePages: 50,
  coordinate: 3000,
} as const;

export class TemplateBodyError extends Error {
  constructor(readonly errors: string[]) {
    super(errors[0]);
  }
}

class Collector {
  readonly errors: string[] = [];
  add(msg: string) {
    if (this.errors.length < 20) this.errors.push(msg);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const KEY_RE = /^[a-z0-9_-]{1,40}$/;

function text(
  c: Collector,
  where: string,
  v: unknown,
  max: number,
  required = true,
  allowRow = false,
): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) c.add(`${where}: falta el texto`);
    return undefined;
  }
  if (typeof v !== 'string') {
    c.add(`${where}: debe ser texto`);
    return undefined;
  }
  if (v.length > max) c.add(`${where}: supera ${max} caracteres`);
  try {
    const segments = parseTemplateText(v);
    if (!allowRow && segments.some((s) => s.type === 'token' && s.ref.path.startsWith('row.'))) {
      c.add(`${where}: las variables 'row.*' solo se usan en las columnas de una tabla`);
    }
  } catch (e) {
    c.add(`${where}: ${e instanceof TokenSyntaxError ? e.message : 'variable inválida'}`);
  }
  return v;
}

function num(c: Collector, where: string, v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    c.add(`${where}: debe ser un número entre ${min} y ${max}`);
    return undefined;
  }
  return v;
}

function align(c: Collector, where: string, v: unknown) {
  if (v !== undefined && !(ALIGNS as readonly string[]).includes(v as string)) {
    c.add(`${where}: alineación no válida`);
  }
}

function slots(c: Collector, raw: unknown, withBox: boolean): Array<Record<string, unknown>> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    c.add('signature_slots: debe ser una lista');
    return [];
  }
  if (raw.length > LIMITS.slots) c.add(`signature_slots: máximo ${LIMITS.slots} casillas`);
  const seen = new Set<string>();
  raw.forEach((s, i) => {
    const where = `Casilla de firma ${i + 1}`;
    if (!isObj(s)) return c.add(`${where}: no es válida`);
    if (typeof s.key !== 'string' || !KEY_RE.test(s.key)) c.add(`${where}: la clave debe ser a-z, 0-9, "-" o "_"`);
    else if (seen.has(s.key)) c.add(`${where}: la clave '${s.key}' está repetida`);
    else seen.add(s.key);
    if (typeof s.role_label !== 'string' || !s.role_label.trim() || s.role_label.length > 80) {
      c.add(`${where}: falta el rol (máximo 80 caracteres)`);
    }
    if (withBox) boxCheck(c, where, s);
  });
  return raw.filter(isObj);
}

function boxCheck(c: Collector, where: string, o: Record<string, unknown>) {
  if (!Number.isInteger(o.page) || (o.page as number) < 1 || (o.page as number) > LIMITS.basePages) {
    c.add(`${where}: la página debe estar entre 1 y ${LIMITS.basePages}`);
  }
  num(c, `${where} (x)`, o.x, 0, LIMITS.coordinate);
  num(c, `${where} (y)`, o.y, 0, LIMITS.coordinate);
  num(c, `${where} (ancho)`, o.width, 4, LIMITS.coordinate);
  num(c, `${where} (alto)`, o.height, 4, LIMITS.coordinate);
}

/** Validates a block body. Throws {@link TemplateBodyError} listing every problem found. */
export function validateBlocksBody(raw: unknown): BlocksBody {
  const c = new Collector();
  if (!isObj(raw)) throw new TemplateBodyError(['El cuerpo de la plantilla debe ser un objeto']);
  const page = isObj(raw.page) ? raw.page : {};
  if (!(PAGE_SIZES as readonly string[]).includes(page.size as string)) {
    c.add("page.size: debe ser 'A4' o 'LETTER'");
  }
  if (page.margin !== undefined) num(c, 'page.margin', page.margin, 20, 100);

  if (raw.header !== undefined) {
    if (!isObj(raw.header)) c.add('header: no es válido');
    else {
      text(c, 'Encabezado', raw.header.text, LIMITS.short, false);
      if (raw.header.show_logo !== undefined && typeof raw.header.show_logo !== 'boolean') {
        c.add('header.show_logo: debe ser verdadero o falso');
      }
    }
  }
  if (raw.footer !== undefined) {
    if (!isObj(raw.footer)) c.add('footer: no es válido');
    else {
      text(c, 'Pie de página', raw.footer.text, LIMITS.short, false);
      if (raw.footer.page_numbers !== undefined && typeof raw.footer.page_numbers !== 'boolean') {
        c.add('footer.page_numbers: debe ser verdadero o falso');
      }
    }
  }

  const slotList = slots(c, raw.signature_slots, false);
  const slotKeys = new Set(slotList.map((s) => s.key as string));

  if (!Array.isArray(raw.blocks)) {
    c.add('blocks: debe ser una lista');
  } else {
    if (raw.blocks.length === 0) c.add('La plantilla necesita al menos un bloque');
    if (raw.blocks.length > LIMITS.blocks) c.add(`blocks: máximo ${LIMITS.blocks} bloques`);
    raw.blocks.slice(0, LIMITS.blocks).forEach((b, i) => {
      const where = `Bloque ${i + 1}`;
      if (!isObj(b)) return c.add(`${where}: no es válido`);
      switch (b.type) {
        case 'heading':
          text(c, `${where} (título)`, b.text, LIMITS.short);
          if (![1, 2, 3].includes(b.level as number)) c.add(`${where}: el nivel debe ser 1, 2 o 3`);
          align(c, where, b.align);
          break;
        case 'paragraph':
          text(c, `${where} (párrafo)`, b.text, LIMITS.text);
          align(c, where, b.align);
          break;
        case 'fields':
          if (!Array.isArray(b.rows) || b.rows.length === 0 || b.rows.length > LIMITS.rows) {
            c.add(`${where}: las filas deben ser entre 1 y ${LIMITS.rows}`);
          } else {
            b.rows.forEach((r, j) => {
              if (!isObj(r)) return c.add(`${where}, fila ${j + 1}: no es válida`);
              text(c, `${where}, fila ${j + 1} (etiqueta)`, r.label, LIMITS.short);
              text(c, `${where}, fila ${j + 1} (valor)`, r.value, LIMITS.short);
            });
          }
          break;
        case 'table':
          if (typeof b.source !== 'string' || !/^fields\.[A-Za-z0-9_.]+$/.test(b.source)) {
            c.add(`${where}: el origen de la tabla debe ser una lista de la solicitud (fields.<campo>)`);
          }
          if (!Array.isArray(b.columns) || b.columns.length === 0 || b.columns.length > LIMITS.columns) {
            c.add(`${where}: las columnas deben ser entre 1 y ${LIMITS.columns}`);
          } else {
            b.columns.forEach((col, j) => {
              if (!isObj(col)) return c.add(`${where}, columna ${j + 1}: no es válida`);
              text(c, `${where}, columna ${j + 1} (encabezado)`, col.header, LIMITS.short);
              text(c, `${where}, columna ${j + 1} (valor)`, col.value, LIMITS.short, true, true);
            });
          }
          break;
        case 'image':
          if (b.source !== 'store.logo') c.add(`${where}: solo se admite la imagen 'store.logo'`);
          if (b.width !== undefined) num(c, `${where} (ancho)`, b.width, 20, 400);
          break;
        case 'spacer':
          num(c, `${where} (alto)`, b.height, 4, 200);
          break;
        case 'page_break':
          break;
        case 'signature':
          if (typeof b.slot_key !== 'string' || !slotKeys.has(b.slot_key)) {
            c.add(`${where}: la casilla de firma '${String(b.slot_key)}' no está declarada`);
          }
          break;
        default:
          c.add(`${where}: el tipo '${String(b.type)}' no existe`);
      }
    });
  }
  if (c.errors.length > 0) throw new TemplateBodyError(c.errors);
  return raw as unknown as BlocksBody;
}

/** Validates a base-PDF body. `pageCount` (when known) bounds every `page`. */
export function validateBasePdfBody(raw: unknown, pageCount?: number): BasePdfBody {
  const c = new Collector();
  if (!isObj(raw)) throw new TemplateBodyError(['El cuerpo de la plantilla debe ser un objeto']);
  const fields = raw.fields ?? [];
  if (!Array.isArray(fields)) c.add('fields: debe ser una lista');
  else {
    if (fields.length > LIMITS.baseFields) c.add(`fields: máximo ${LIMITS.baseFields} campos`);
    fields.slice(0, LIMITS.baseFields).forEach((f, i) => {
      const where = `Campo ${i + 1}`;
      if (!isObj(f)) return c.add(`${where}: no es válido`);
      boxCheck(c, where, f);
      text(c, `${where} (valor)`, f.value, LIMITS.short);
      if (f.font_size !== undefined) num(c, `${where} (tamaño de letra)`, f.font_size, 6, 48);
      align(c, where, f.align);
    });
  }
  const slotList = slots(c, raw.signature_slots ?? [], true);
  if (pageCount !== undefined) {
    for (const o of [...(Array.isArray(fields) ? fields : []), ...slotList]) {
      if (isObj(o) && Number.isInteger(o.page) && (o.page as number) > pageCount) {
        c.add(`La página ${String(o.page)} no existe: el PDF base tiene ${pageCount}`);
      }
    }
  }
  if (c.errors.length > 0) throw new TemplateBodyError(c.errors);
  return { fields: (fields as BasePdfField[]) ?? [], signature_slots: slotList as unknown as BasePdfSlot[] };
}

/** Texts of a block body that may hold tokens. */
export function blockTexts(body: BlocksBody): string[] {
  const out: string[] = [];
  if (body.header?.text) out.push(body.header.text);
  if (body.footer?.text) out.push(body.footer.text);
  for (const b of body.blocks) {
    if (b.type === 'heading' || b.type === 'paragraph') out.push(b.text);
    else if (b.type === 'fields') b.rows.forEach((r) => out.push(r.label, r.value));
    else if (b.type === 'table') b.columns.forEach((col) => out.push(col.header, col.value));
  }
  return out;
}

/** `token_schema` of a validated body (table sources are required lists; the logo is optional). */
export function tokenSchemaOfBlocks(body: BlocksBody): TokenSchemaEntry[] {
  const extra: TokenSchemaEntry[] = [];
  for (const b of body.blocks) if (b.type === 'table') extra.push({ path: b.source, required: true });
  if (body.header?.show_logo || body.blocks.some((b) => b.type === 'image')) {
    extra.push({ path: 'store.logo', required: false });
  }
  return mergeSchema(buildTokenSchema(blockTexts(body)), extra);
}

/** Every text of a validated body that may hold tokens (either kind). */
export function bodyTexts(kind: 'blocks' | 'base_pdf', body: BlocksBody | BasePdfBody): string[] {
  return kind === 'blocks'
    ? blockTexts(body as BlocksBody)
    : (body as BasePdfBody).fields.map((f) => f.value);
}

/** Lists the table blocks use as sources (for preview data). */
export function tableSourcesOf(body: BlocksBody): string[] {
  return body.blocks.flatMap((b) => (b.type === 'table' ? [b.source] : []));
}

export function tokenSchemaOfBasePdf(body: BasePdfBody): TokenSchemaEntry[] {
  return buildTokenSchema(body.fields.map((f) => f.value));
}

function mergeSchema(a: TokenSchemaEntry[], b: TokenSchemaEntry[]): TokenSchemaEntry[] {
  const map = new Map<string, TokenSchemaEntry>();
  for (const e of [...a, ...b]) {
    const prev = map.get(e.path);
    map.set(e.path, { path: e.path, required: (prev?.required ?? false) || e.required });
  }
  return [...map.values()].sort((x, y) => x.path.localeCompare(y.path));
}

/** Signature slots declared by a body (both kinds). */
export function slotsOf(body: BlocksBody | BasePdfBody): SignatureSlot[] {
  return (body.signature_slots ?? []).map((s) => ({ key: s.key, role_label: s.role_label }));
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Stable sha256 of a body (and of its base PDF content, when it has one). */
export function bodyHash(kind: string, body: unknown, baseFileSha256: string | null): string {
  return createHash('sha256').update(canonical({ kind, body, base: baseFileSha256 })).digest('hex');
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
