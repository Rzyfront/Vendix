import {
  ANALYSIS_LIMITS,
  AnalysisCell,
  AnalysisError,
  AnalysisFailureCode,
  AnalysisInputTable,
  AnalysisLimits,
  AnalysisOutput,
} from './interfaces/analysis-protocol.interface';

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_LABEL = 120;
const MAX_COLUMNS = 50;
const MAX_DATASETS = 6;
const MAX_NOTES = 5;
const MAX_NOTE_CHARS = 300;
const CHARTS = new Set(['line', 'bar', 'scatter']);

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function bytes(value: unknown): number {
  const json = JSON.stringify(value);
  return json === undefined ? 0 : Buffer.byteLength(json, 'utf8');
}

class Guard {
  constructor(private readonly code: AnalysisFailureCode) {}
  fail(detail: string): never {
    throw new AnalysisError(this.code, detail);
  }
  ensure(condition: boolean, detail: string): void {
    if (!condition) this.fail(detail);
  }
  obj(value: unknown, allowed: string[], where: string): Obj {
    if (!isObj(value)) this.fail(`${where} must be an object`);
    for (const key of Object.keys(value))
      if (!allowed.includes(key)) this.fail(`${where} has unknown key`);
    return value;
  }
  array(value: unknown, max: number, where: string): unknown[] {
    if (!Array.isArray(value)) this.fail(`${where} must be an array`);
    if (value.length > max) this.fail(`${where} exceeds ${max} items`);
    return value;
  }
  text(value: unknown, max: number, where: string): string {
    if (typeof value !== 'string' || !value.length || value.length > max)
      this.fail(`${where} must be a non-empty string up to ${max} chars`);
    return value;
  }
  finite(value: unknown, where: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value))
      this.fail(`${where} must be a finite number`);
    return value;
  }
}

/** Strict schema check of what generated code assigned to `result`. */
export function validateAnalysisOutput(
  raw: unknown,
  limits: Readonly<AnalysisLimits> = ANALYSIS_LIMITS,
): AnalysisOutput {
  const g = new Guard('ANALYSIS_OUTPUT');
  const root = g.obj(raw, ['tables', 'series', 'figures', 'notes'], 'output');
  const out: AnalysisOutput = {};

  if (root.tables !== undefined) {
    out.tables = g
      .array(root.tables, limits.output_tables, 'tables')
      .map((entry, i) => {
        const t = g.obj(entry, ['title', 'columns', 'rows'], `tables[${i}]`);
        const title = g.text(t.title, MAX_LABEL, 'table title');
        const columns = g
          .array(t.columns, MAX_COLUMNS, 'table columns')
          .map((c) => g.text(c, MAX_LABEL, 'table column'));
        g.ensure(columns.length > 0, 'table needs columns');
        const rows = g
          .array(t.rows, limits.output_rows, 'table rows')
          .map((row) => {
            const cells = g.array(row, columns.length, 'table row');
            g.ensure(cells.length === columns.length, 'row/column mismatch');
            return cells.map((cell): string | number | null => {
              if (cell === null || typeof cell === 'string') return cell;
              return g.finite(cell, 'table cell');
            });
          });
        return { title, columns, rows };
      });
  }

  if (root.series !== undefined) {
    out.series = g
      .array(root.series, limits.output_series, 'series')
      .map((entry, i) => {
        const s = g.obj(
          entry,
          ['title', 'chart', 'x_label', 'y_label', 'x', 'datasets'],
          `series[${i}]`,
        );
        const title = g.text(s.title, MAX_LABEL, 'series title');
        g.ensure(
          typeof s.chart === 'string' && CHARTS.has(s.chart),
          'series chart type invalid',
        );
        const item: NonNullable<AnalysisOutput['series']>[number] = {
          title,
          chart: s.chart as 'line' | 'bar' | 'scatter',
          x: g
            .array(s.x, limits.output_points, 'series x')
            .map((v): string | number =>
              typeof v === 'string' ? v : g.finite(v, 'series x'),
            ),
          datasets: [],
        };
        g.ensure(item.x.length > 0, 'series x is empty');
        if (s.x_label !== undefined)
          item.x_label = g.text(s.x_label, MAX_LABEL, 'x_label');
        if (s.y_label !== undefined)
          item.y_label = g.text(s.y_label, MAX_LABEL, 'y_label');
        item.datasets = g
          .array(s.datasets, MAX_DATASETS, 'series datasets')
          .map((d) => {
            const ds = g.obj(d, ['label', 'values'], 'dataset');
            const values = g
              .array(ds.values, limits.output_points, 'dataset values')
              .map((v) => (v === null ? null : g.finite(v, 'dataset value')));
            g.ensure(values.length === item.x.length, 'dataset length mismatch');
            return { label: g.text(ds.label, MAX_LABEL, 'dataset label'), values };
          });
        g.ensure(item.datasets.length > 0, 'series needs datasets');
        return item;
      });
  }

  if (root.figures !== undefined) {
    out.figures = g
      .array(root.figures, limits.output_figures, 'figures')
      .map((entry, i) => {
        const f = g.obj(entry, ['label', 'value', 'unit'], `figures[${i}]`);
        const figure: NonNullable<AnalysisOutput['figures']>[number] = {
          label: g.text(f.label, MAX_LABEL, 'figure label'),
          value:
            f.value === null || typeof f.value === 'string'
              ? (f.value as string | null)
              : g.finite(f.value, 'figure value'),
        };
        if (typeof figure.value === 'string')
          g.ensure(figure.value.length <= MAX_LABEL, 'figure value too long');
        if (f.unit !== undefined)
          figure.unit = g.text(f.unit, MAX_LABEL, 'figure unit');
        return figure;
      });
  }

  if (root.notes !== undefined)
    out.notes = g
      .array(root.notes, MAX_NOTES, 'notes')
      .map((n) => g.text(n, MAX_NOTE_CHARS, 'note'));

  g.ensure(
    !!out.tables?.length || !!out.series?.length || !!out.figures?.length,
    'output has no tables, series or figures',
  );
  g.ensure(bytes(out) <= limits.output_bytes, 'output exceeds byte limit');
  return out;
}

/** Validates the host-materialized datasets before they leave the process. */
export function validateAnalysisInputs(
  raw: unknown,
  limits: Readonly<AnalysisLimits> = ANALYSIS_LIMITS,
): AnalysisInputTable[] {
  const g = new Guard('ANALYSIS_INPUT');
  const tables = g.array(raw, limits.input_tables, 'inputs');
  const names = new Set<string>();
  const result = tables.map((entry, i) => {
    const t = g.obj(entry, ['name', 'columns', 'rows'], `inputs[${i}]`);
    g.ensure(typeof t.name === 'string' && NAME.test(t.name), 'input name invalid');
    const name = t.name as string;
    g.ensure(!names.has(name), 'input name duplicated');
    names.add(name);
    const columns = g
      .array(t.columns, limits.input_columns, 'input columns')
      .map((c) => g.text(c, MAX_LABEL, 'input column'));
    g.ensure(columns.length > 0, 'input needs columns');
    const rows = g.array(t.rows, limits.input_rows, 'input rows').map((row) => {
      const cells = g.array(row, columns.length, 'input row');
      g.ensure(cells.length === columns.length, 'row/column mismatch');
      return cells.map((cell): AnalysisCell => {
        if (cell === null || typeof cell === 'string' || typeof cell === 'boolean')
          return cell;
        return g.finite(cell, 'input cell');
      });
    });
    return { name, columns, rows };
  });
  g.ensure(bytes(result) <= limits.input_bytes, 'inputs exceed byte limit');
  return result;
}
