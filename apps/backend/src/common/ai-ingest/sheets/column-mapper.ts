import { normalizeLabel } from './sheet-parser.service';
import type { ExtractionSchema } from '../extraction/ai-extraction.service';

/** header label (as in `SheetTable.headers`) → profile field. */
export type ColumnMapping<TField extends string> = Map<string, TField>;

/**
 * `normalizeLabel` plus initials joined: "C.C." → "c c" → "cc", "N.I.T" →
 * "nit". Runs of two or more one-letter words are glued; the rest stays.
 */
export function headerKey(value: string): string {
  return normalizeLabel(value).replace(
    /\b[a-z](?: [a-z]\b)+/g,
    (run) => run.replace(/ /g, ''),
  );
}

/**
 * Deterministic header → field mapping from a synonym dictionary.
 * An exact label match beats a whole-word match inside a longer label, and a
 * longer synonym beats a shorter one; each header and each field is used once.
 */
export function mapColumnsBySynonyms<TField extends string>(
  headers: readonly string[],
  synonyms: Record<TField, string[]>,
): ColumnMapping<TField> {
  const candidates: { header: string; field: TField; score: number }[] = [];
  for (const header of headers) {
    const label = headerKey(header);
    if (!label) continue;
    const padded = ` ${label} `;
    for (const field of Object.keys(synonyms) as TField[]) {
      let best = 0;
      for (const synonym of synonyms[field]) {
        const key = headerKey(synonym);
        if (!key) continue;
        if (label === key) best = Math.max(best, 1000 + key.length);
        else if (padded.includes(` ${key} `)) best = Math.max(best, 100 + key.length);
      }
      if (best) candidates.push({ header, field, score: best });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const mapping: ColumnMapping<TField> = new Map();
  const usedFields = new Set<TField>();
  for (const c of candidates) {
    if (mapping.has(c.header) || usedFields.has(c.field)) continue;
    mapping.set(c.header, c.field);
    usedFields.add(c.field);
  }
  return mapping;
}

/**
 * Headers no synonym took that carry data in the sample rows: worth showing
 * to the AI mapping call (an empty or unnamed-and-empty column is not).
 */
export function unmappedHeadersWithData<TField extends string>(
  headers: readonly string[],
  mapping: ColumnMapping<TField>,
  sample: readonly Record<string, string>[],
): string[] {
  return headers.filter(
    (h) => !mapping.has(h) && sample.some((row) => (row[h] ?? '').trim() !== ''),
  );
}

/** Required groups (alternatives) that no mapped column covers. */
export function missingRequiredGroups<TField extends string>(
  mapping: ColumnMapping<TField>,
  required: TField[][],
): TField[][] {
  const mapped = new Set(mapping.values());
  return required.filter((group) => !group.some((f) => mapped.has(f)));
}

/**
 * Adds the AI answer to a synonym mapping: only headers still unmapped and
 * fields still free are taken, and unknown headers or fields are ignored.
 */
export function mergeAiColumnMapping<TField extends string>(
  base: ColumnMapping<TField>,
  headers: readonly string[],
  fields: readonly TField[],
  answer: { columns?: { column?: unknown; field?: unknown }[] },
): ColumnMapping<TField> {
  const merged: ColumnMapping<TField> = new Map(base);
  const used = new Set(merged.values());
  const byLabel = new Map(headers.map((h) => [normalizeLabel(h), h]));
  for (const entry of answer.columns ?? []) {
    const header =
      typeof entry.column === 'string'
        ? (headers.includes(entry.column)
            ? entry.column
            : byLabel.get(normalizeLabel(entry.column)))
        : undefined;
    const field = entry.field as TField;
    if (!header || !fields.includes(field) || merged.has(header) || used.has(field)) {
      continue;
    }
    merged.set(header, field);
    used.add(field);
  }
  return merged;
}

/** Schema of the single "map these columns" call. */
export function columnMappingSchema(fields: readonly string[]): ExtractionSchema {
  return {
    name: 'column_mapping',
    schema: {
      type: 'object',
      required: ['columns'],
      properties: {
        columns: {
          type: 'array',
          items: {
            type: 'object',
            required: ['column', 'field'],
            properties: {
              column: { type: 'string' },
              field: { type: 'string', enum: [...fields, 'ignore'] },
            },
          },
        },
        warnings: { type: 'array', items: { type: 'string' } },
      },
    },
  };
}

/** Row values of the mapped fields only. */
export function applyColumnMapping<TField extends string>(
  row: Record<string, string>,
  mapping: ColumnMapping<TField>,
): Partial<Record<TField, string>> {
  const out: Partial<Record<TField, string>> = {};
  for (const [header, field] of mapping) {
    const value = row[header];
    if (value) out[field] = value;
  }
  return out;
}
