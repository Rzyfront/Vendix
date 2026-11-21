import {
  VexBlockTabularData,
  VexChartSpec,
  VexListData,
  VexListItem,
  VexTableSpec,
  VexTimelineData,
  VexUiBlock,
} from '../../models/vex.models';
import { VEX_COPY } from '../../vex-copy';

export type VexExportCell = string | number | null;

/** Flat, kind-agnostic view of what a block shows: one header row + data rows. */
export interface VexBlockExportTable {
  headers: string[];
  rows: VexExportCell[][];
  /** File name without extension. */
  filename: string;
}

const EXPORTABLE_KINDS: ReadonlyArray<string> = [
  'table',
  'chart',
  'list',
  'timeline',
];

const copy = VEX_COPY.blocks.export;

export function isBlockExportable(block: VexUiBlock): boolean {
  return EXPORTABLE_KINDS.includes(block.kind);
}

/**
 * Converts a block into the exact grid the person sees. Returns `null` for
 * kinds without tabular content (kpi, image, file, markdown) or unknown kinds.
 */
export function blockToExportTable(
  block: VexUiBlock,
): VexBlockExportTable | null {
  switch (block.kind) {
    case 'table':
      return tableToGrid(block);
    case 'chart':
      return chartToGrid(block);
    case 'list':
      return listToGrid(block);
    case 'timeline':
      return timelineToGrid(block);
    default:
      return null;
  }
}

function cell(value: unknown): VexExportCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value);
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object',
      )
    : [];
}

function slug(text: string | undefined, fallback: string): string {
  const base = (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${copy.default_filename}-${base || fallback}`;
}

function tableToGrid(block: VexUiBlock): VexBlockExportTable {
  const spec = block.spec as Partial<VexTableSpec>;
  const columns = Array.isArray(spec.columns) ? spec.columns : [];
  const rows = asRecords((block.data as Partial<VexBlockTabularData>).rows);
  return {
    headers: columns.map((column) => column.label ?? column.key),
    rows: rows.map((row) => columns.map((column) => cell(row[column.key]))),
    filename: slug(spec.title, 'tabla'),
  };
}

function chartToGrid(block: VexUiBlock): VexBlockExportTable {
  const spec = block.spec as Partial<VexChartSpec>;
  const data = block.data as {
    rows?: unknown;
    labels?: unknown;
    series?: unknown;
  };
  const filename = slug(spec.title, 'grafico');

  // Persisted shape `{ labels, series: [{ name, data }] }` (raw block payload).
  if (!Array.isArray(data.rows) && Array.isArray(data.series)) {
    const series = asRecords(data.series);
    const labels = Array.isArray(data.labels) ? data.labels : [];
    const count = Math.max(
      labels.length,
      ...series.map((s) => (Array.isArray(s['data']) ? s['data'].length : 0)),
    );
    return {
      headers: [
        copy.header_label,
        ...series.map((s, i) => String(s['name'] ?? `Serie ${i + 1}`)),
      ],
      rows: Array.from({ length: count }, (_, i) => [
        cell(labels[i] ?? copy.point_fallback(i + 1)),
        ...series.map((s) =>
          cell(Array.isArray(s['data']) ? s['data'][i] : null),
        ),
      ]),
      filename,
    };
  }

  // Render shape used by the component: rows + key-mapped series.
  const rows = asRecords(data.rows);
  const series = Array.isArray(spec.series) ? spec.series : [];
  const labelKey = spec.x_axis_key ?? 'label';
  return {
    headers: [copy.header_label, ...series.map((s) => s.label ?? s.key)],
    rows: rows.map((row) => [
      cell(row[labelKey]),
      ...series.map((s) => cell(row[s.key])),
    ]),
    filename,
  };
}

function listToGrid(block: VexUiBlock): VexBlockExportTable {
  const spec = block.spec as { title?: string };
  const items: VexListItem[] = asRecords(
    (block.data as Partial<VexListData>).items,
  ) as unknown as VexListItem[];
  const fieldLabels: string[] = [];
  for (const item of items) {
    for (const field of item.fields ?? []) {
      if (!fieldLabels.includes(field.label)) fieldLabels.push(field.label);
    }
  }
  return {
    headers: [
      copy.header_title,
      copy.header_subtitle,
      copy.header_description,
      copy.header_badge,
      ...fieldLabels,
    ],
    rows: items.map((item) => [
      cell(item.title),
      cell(item.subtitle),
      cell(item.description),
      cell(item.badge?.label),
      ...fieldLabels.map((label) =>
        cell(item.fields?.find((field) => field.label === label)?.value),
      ),
    ]),
    filename: slug(spec.title, 'lista'),
  };
}

function timelineToGrid(block: VexUiBlock): VexBlockExportTable {
  const spec = block.spec as { title?: string };
  const events = asRecords((block.data as Partial<VexTimelineData>).events);
  return {
    headers: [
      copy.header_date,
      copy.header_event,
      copy.header_description,
      copy.header_badge,
      copy.header_actor,
    ],
    rows: events.map((event) => [
      cell(event['timestamp']),
      cell(event['title']),
      cell(event['description']),
      cell(event['status']),
      cell(event['actor']),
    ]),
    filename: slug(spec.title, 'linea-de-tiempo'),
  };
}

/** RFC 4180 CSV with BOM so Excel reads UTF-8 accents correctly. */
export function exportTableToCsv(table: VexBlockExportTable): string {
  const escape = (value: VexExportCell): string => {
    if (value === null) return '';
    let text = String(value);
    // Neutralise spreadsheet formula injection on text cells only.
    if (typeof value === 'string' && /^[=+@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [table.headers, ...table.rows].map((line) =>
    line.map(escape).join(','),
  );
  return `﻿${lines.join('\r\n')}`;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Returns false when the block has no tabular content. */
export function exportBlockCsv(block: VexUiBlock): boolean {
  const table = blockToExportTable(block);
  if (!table) return false;
  download(
    new Blob([exportTableToCsv(table)], { type: 'text/csv;charset=utf-8' }),
    `${table.filename}.csv`,
  );
  return true;
}

/** Returns false when the block has no tabular content. */
export async function exportBlockXlsx(block: VexUiBlock): Promise<boolean> {
  const table = blockToExportTable(block);
  if (!table) return false;
  // Lazy: xlsx is large and only needed when someone exports.
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, copy.sheet_name);
  XLSX.writeFile(book, `${table.filename}.xlsx`);
  return true;
}

/** Saves a PNG data URL (e.g. from `echarts.getDataURL`). */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `${filename}.png`;
  link.click();
}
