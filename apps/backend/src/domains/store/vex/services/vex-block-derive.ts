import Decimal from 'decimal.js';
import {
  ExpressionError,
  MAX_DECIMAL_EXPONENT,
  evaluateDecimalExpression,
  parseBoundedDecimal,
} from '../../../../ai-engine/tools/compute/decimal-expression';

/**
 * Pure row transforms for `vex_block_transform` (F7/T48): derived columns,
 * period comparison and join. No I/O; the service wires them into
 * `VexBlockTransform`.
 */

export type Row = Record<string, unknown>;

export const MAX_DERIVED_COLUMNS = 10;
export const MAX_JOIN_ROWS = 5000;

export interface VexBlockDeriveSpec {
  name: string;
  expression: string;
}
export interface VexBlockCompareSpec {
  key: string;
  period_field: string;
  current: string | number;
  previous: string | number;
  value_field: string;
}
export interface VexBlockJoinSpec {
  on: string;
  right_on?: string;
  type?: 'inner' | 'left';
  right_prefix?: string;
}

export class VexBlockDeriveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VexBlockDeriveError';
  }
}

/** Column name -> ASCII snake_case identifier ("Ventas Mes" -> "ventas_mes"). */
export function normalizeColumnName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!base) return '_';
  return /^[0-9]/.test(base) ? `_${base}` : base;
}

/**
 * Bounded decimal of a cell, or null when the cell is not a number (text,
 * null, boolean). Same entry as the evaluator: a cell in scientific notation
 * or outside ±1e30 is never turned into a Decimal.
 */
export function numericCell(
  value: unknown,
): Decimal | null | 'out_of_range' {
  return parseBoundedDecimal(value);
}

const outOfRangeCell = (column: string, row: number) =>
  new VexBlockDeriveError(
    `La celda "${column}" de la fila ${row} no es un decimal admitido: sin notación científica y dentro de ±1e${MAX_DECIMAL_EXPONENT}.`,
  );

export function applyDerive(rows: Row[], derive: VexBlockDeriveSpec[]): Row[] {
  if (!Array.isArray(derive) || derive.length === 0) {
    throw new VexBlockDeriveError('derive necesita al menos una columna.');
  }
  if (derive.length > MAX_DERIVED_COLUMNS) {
    throw new VexBlockDeriveError(
      `derive admite máximo ${MAX_DERIVED_COLUMNS} columnas (llegaron ${derive.length}).`,
    );
  }
  return rows.map((row, index) => {
    const out: Row = { ...row };
    const vars: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(row)) {
      // An out-of-range cell stays in scope as raw text: the evaluator rejects
      // it by name only if an expression actually uses it.
      if (numericCell(v) !== null) {
        vars[normalizeColumnName(k)] = v as number | string;
      }
    }
    for (const d of derive) {
      try {
        const r = evaluateDecimalExpression(d.expression, vars);
        out[d.name] = r.value;
        if (r.value !== null) vars[normalizeColumnName(d.name)] = r.value;
      } catch (error) {
        if (error instanceof ExpressionError) {
          throw new VexBlockDeriveError(
            `Columna derivada "${d.name}" (fila ${index + 1}): ${error.message}`,
          );
        }
        throw error;
      }
    }
    return out;
  });
}

export function applyCompare(rows: Row[], compare: VexBlockCompareSpec): Row[] {
  const { key, period_field, value_field } = compare;
  const groups = new Map<
    string,
    { key: unknown; cur: Decimal | null; prev: Decimal | null }
  >();
  const sum = (acc: Decimal | null, v: unknown, row: number): Decimal | null => {
    const n = numericCell(v);
    if (n === null) return acc;
    if (n === 'out_of_range') throw outOfRangeCell(value_field, row);
    return (acc ?? new Decimal(0)).plus(n);
  };
  let rowNumber = 0;
  for (const row of rows) {
    rowNumber++;
    const k = row[key];
    const id = String(k);
    const g = groups.get(id) ?? { key: k, cur: null, prev: null };
    const period = row[period_field];
    if (String(period) === String(compare.current))
      g.cur = sum(g.cur, row[value_field], rowNumber);
    else if (String(period) === String(compare.previous))
      g.prev = sum(g.prev, row[value_field], rowNumber);
    groups.set(id, g);
  }
  return [...groups.values()].map((g) => {
    const delta =
      g.cur !== null && g.prev !== null ? g.cur.minus(g.prev) : null;
    // Same rule as computeGrowth (analytics-metrics.contract.ts:307): null without base.
    const pct =
      g.cur !== null && g.prev !== null && !g.prev.isZero()
        ? g.cur.minus(g.prev).div(g.prev.abs()).times(100)
        : null;
    return {
      [key]: g.key,
      current: g.cur === null ? null : g.cur.toFixed(),
      previous: g.prev === null ? null : g.prev.toFixed(),
      delta: delta === null ? null : delta.toFixed(),
      pct_change:
        pct === null
          ? null
          : pct.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(),
    };
  });
}

export function applyJoin(
  left: Row[],
  right: Row[],
  join: VexBlockJoinSpec,
): Row[] {
  const rightOn = join.right_on ?? join.on;
  const prefix = join.right_prefix ?? 'right_';
  const type = join.type ?? 'inner';
  const index = new Map<string, Row[]>();
  for (const r of right) {
    const k = r[rightOn];
    if (k === null || k === undefined) continue;
    const id = String(k);
    const bucket = index.get(id);
    if (bucket) bucket.push(r);
    else index.set(id, [r]);
  }
  const out: Row[] = [];
  const push = (row: Row) => {
    if (out.length >= MAX_JOIN_ROWS) {
      throw new VexBlockDeriveError(
        `La unión supera ${MAX_JOIN_ROWS} filas; filtra o agrega los bloques antes de unirlos.`,
      );
    }
    out.push(row);
  };
  const rightCols = new Set<string>();
  for (const r of right) for (const c of Object.keys(r)) rightCols.add(c);
  for (const l of left) {
    const k = l[join.on];
    const matches =
      k === null || k === undefined ? undefined : index.get(String(k));
    if (!matches) {
      if (type === 'left') {
        const row: Row = { ...l };
        for (const c of rightCols) {
          if (c === rightOn) continue;
          row[c in l ? `${prefix}${c}` : c] = null;
        }
        push(row);
      }
      continue;
    }
    for (const r of matches) {
      const row: Row = { ...l };
      for (const [c, v] of Object.entries(r)) {
        if (c === rightOn && rightOn === join.on) continue;
        row[c in l ? `${prefix}${c}` : c] = v;
      }
      push(row);
    }
  }
  return out;
}

// ── filter / sort / aggregate ────────────────────────────────────────────
//
// Derived columns, `compare` outputs and Prisma decimals arrive as decimal
// STRINGS. These three steps therefore read numbers through `numericCell`:
// "100" sorts after "45.2", `margen > 5` keeps the row, and a sum adds it.
// Text columns keep their text behaviour.

export interface VexBlockFilterSpec {
  field: string;
  op: string;
  value: unknown;
}
export interface VexBlockSortSpec {
  field: string;
  direction?: 'asc' | 'desc';
}
export interface VexBlockAggregateSpec {
  field: string;
  function: 'sum' | 'avg' | 'count' | 'min' | 'max';
}

const RANGE_OPS = new Set(['gt', 'gte', 'lt', 'lte']);
const isBlank = (v: unknown) => v === null || v === undefined || v === '';
const preview = (v: unknown) => {
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
};

/** `25` equals `"25"` and `"25.00"`; everything else stays strict. */
function looseEquals(field: unknown, value: unknown): boolean {
  if (field === value) return true;
  if (typeof field === typeof value) return false;
  const a = numericCell(field);
  const b = numericCell(value);
  return a instanceof Decimal && b instanceof Decimal && a.eq(b);
}

export function applyFilters(rows: Row[], filters: VexBlockFilterSpec[]): Row[] {
  let out = rows;
  for (const f of filters) {
    if (!RANGE_OPS.has(f.op)) {
      out = out.filter((r) => matchesPlain(r[f.field], f.op, f.value));
      continue;
    }
    const bound = numericCell(f.value);
    if (!(bound instanceof Decimal)) {
      throw new VexBlockDeriveError(
        `El filtro ${f.op} sobre "${f.field}" necesita un valor numérico y llegó ${preview(f.value)}. Para texto usa eq, neq, contains o in.`,
      );
    }
    if (out.length > 0 && out.every((r) => r[f.field] === undefined)) {
      throw new VexBlockDeriveError(
        `El filtro ${f.op} usa la columna "${f.field}", que no existe en las filas. Columnas: ${Object.keys(out[0]).slice(0, 20).join(', ')}.`,
      );
    }
    out = out.filter((r, index) => {
      const cell = r[f.field];
      // No value means no base to compare: the row is left out, like a null margin.
      if (isBlank(cell)) return false;
      const n = numericCell(cell);
      if (!(n instanceof Decimal)) {
        throw new VexBlockDeriveError(
          `El filtro ${f.op} no aplica a "${f.field}": la fila ${index + 1} trae ${preview(cell)}, que no es un número admitido. Para texto usa eq, neq, contains o in.`,
        );
      }
      const c = n.cmp(bound);
      if (f.op === 'gt') return c > 0;
      if (f.op === 'gte') return c >= 0;
      if (f.op === 'lt') return c < 0;
      return c <= 0;
    });
  }
  return out;
}

function matchesPlain(field: unknown, op: string, value: unknown): boolean {
  switch (op) {
    case 'eq':
      return looseEquals(field, value);
    case 'neq':
      return !looseEquals(field, value);
    case 'contains':
      return (
        typeof field === 'string' &&
        typeof value === 'string' &&
        field.toLowerCase().includes(value.toLowerCase())
      );
    case 'in':
      return Array.isArray(value) && value.some((v) => looseEquals(field, v));
    default:
      return false;
  }
}

export function applySort(rows: Row[], sorts: VexBlockSortSpec[]): Row[] {
  const out = [...rows];
  if (sorts.length === 0) return out;
  // A column sorts numerically only when every present value is a number
  // (JS number or decimal string); otherwise it keeps the text order.
  const numeric = sorts.map((s) => {
    const parsed = new Map<Row, Decimal>();
    for (const r of out) {
      const cell = r[s.field];
      if (cell === null || cell === undefined) continue;
      const n = numericCell(cell);
      if (!(n instanceof Decimal)) return null;
      parsed.set(r, n);
    }
    return parsed;
  });
  out.sort((a, b) => {
    for (let i = 0; i < sorts.length; i++) {
      const s = sorts[i];
      const dir = s.direction === 'desc' ? -1 : 1;
      const av = a[s.field] as any;
      const bv = b[s.field] as any;
      if (av === bv) continue;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const parsed = numeric[i];
      if (parsed) {
        const c = parsed.get(a)!.cmp(parsed.get(b)!);
        if (c === 0) continue;
        return c * dir;
      }
      return (av < bv ? -1 : 1) * dir;
    }
    return 0;
  });
  return out;
}

export function applyAggregate(
  rows: Row[],
  groupBy: string | undefined,
  aggregate: VexBlockAggregateSpec,
): Row[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = groupBy ? String(row[groupBy] ?? '—') : 'total';
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  const column = `${aggregate.function}_${aggregate.field}`;
  const out: Row[] = [];
  for (const [key, bucket] of groups) {
    let value: number | string;
    if (aggregate.function === 'count') {
      value = bucket.length;
    } else {
      const cells = bucket.map((r) => r[aggregate.field]);
      // Plain JS numbers keep the float result they always had; as soon as a
      // decimal string takes part the group is computed and returned in Decimal.
      const exact = cells.some((c) => typeof c === 'string' && numericCell(c) !== null);
      value = exact
        ? aggregateDecimals(cells, aggregate)
        : aggregateNumbers(
            cells.filter((c): c is number => typeof c === 'number'),
            aggregate.function,
          );
    }
    out.push(groupBy ? { [groupBy]: key, [column]: value } : { [column]: value });
  }
  return out;
}

function aggregateNumbers(
  numbers: number[],
  fn: 'sum' | 'avg' | 'min' | 'max',
): number {
  if (fn === 'sum') return numbers.reduce((a, b) => a + b, 0);
  if (numbers.length === 0) return 0;
  if (fn === 'avg') return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  // Reduce, not Math.min(...numbers): a spread overflows the stack on big groups.
  return numbers.reduce((a, b) => (fn === 'min' ? (b < a ? b : a) : b > a ? b : a));
}

function aggregateDecimals(
  cells: unknown[],
  aggregate: VexBlockAggregateSpec,
): string {
  const numbers: Decimal[] = [];
  for (const cell of cells) {
    const n = numericCell(cell);
    if (n === null) continue; // text / null: not part of the figure
    if (n === 'out_of_range') {
      throw new VexBlockDeriveError(
        `No se puede calcular ${aggregate.function} de "${aggregate.field}": trae ${preview(cell)}, que no es un decimal admitido (sin notación científica y dentro de ±1e${MAX_DECIMAL_EXPONENT}).`,
      );
    }
    numbers.push(n);
  }
  const total = numbers.reduce((a, b) => a.plus(b), new Decimal(0));
  switch (aggregate.function) {
    case 'sum':
      return total.toFixed();
    case 'avg':
      return total.div(numbers.length).toFixed();
    case 'min':
      return numbers.reduce((a, b) => (b.lt(a) ? b : a)).toFixed();
    default:
      return numbers.reduce((a, b) => (b.gt(a) ? b : a)).toFixed();
  }
}
