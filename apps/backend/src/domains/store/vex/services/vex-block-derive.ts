import Decimal from 'decimal.js';
import {
  ExpressionError,
  evaluateDecimalExpression,
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

function toNumeric(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return new Decimal(value.trim()).isFinite() ? value.trim() : null;
    } catch {
      return null;
    }
  }
  return null;
}

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
      const n = toNumeric(v);
      if (n !== null) vars[normalizeColumnName(k)] = n;
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
  const sum = (acc: Decimal | null, v: unknown): Decimal | null => {
    const n = toNumeric(v);
    if (n === null) return acc;
    return (acc ?? new Decimal(0)).plus(n);
  };
  for (const row of rows) {
    const k = row[key];
    const id = String(k);
    const g = groups.get(id) ?? { key: k, cur: null, prev: null };
    const period = row[period_field];
    if (String(period) === String(compare.current))
      g.cur = sum(g.cur, row[value_field]);
    else if (String(period) === String(compare.previous))
      g.prev = sum(g.prev, row[value_field]);
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
