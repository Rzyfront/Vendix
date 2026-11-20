/**
 * Merge of the answers of ONE form read in several batches (plan ia-cargas
 * F5b). Fiscal forms (RUT, DIAN resolution, habilitación) are read in ONE call
 * whenever they fit, exactly as before; this only runs when the model cut its
 * answer and the reader had to split the pages.
 */

type RawAnswer = Record<string, unknown>;

export function isPresentValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

function isPlainObject(value: unknown): value is RawAnswer {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();
  if (
    (typeof a === 'number' || typeof a === 'string') &&
    (typeof b === 'number' || typeof b === 'string')
  ) {
    return String(a).trim() === String(b).trim();
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface MergedFormAnswer {
  data: RawAnswer;
  /** Dotted keys where two batches read different values (the first one wins). */
  conflicts: string[];
}

/**
 * Several batch answers of one form → ONE raw answer for the scanner's
 * normalizer.
 *
 * - One batch: returned AS IS (the common case: the exact answer of before).
 * - Each key: the first batch (page order) that has a value wins; plain
 *   objects (e.g. `field_confidence`) merge key by key the same way.
 * - `confidence`: the lowest; `extraction_notes`: joined without repeats.
 * - A key two batches read differently is reported in `conflicts`.
 */
export function mergeFormAnswers(answers: RawAnswer[]): MergedFormAnswer {
  if (answers.length === 0) return { data: {}, conflicts: [] };
  if (answers.length === 1) return { data: answers[0] ?? {}, conflicts: [] };

  const conflicts: string[] = [];
  const mergeLevel = (level: RawAnswer[], prefix: string): RawAnswer => {
    const keys = [...new Set(level.flatMap((a) => Object.keys(a ?? {})))];
    const out: RawAnswer = {};
    for (const key of keys) {
      const values = level.map((a) => a?.[key]);
      if (!prefix && key === 'confidence') {
        const numbers = values.map((v) => Number(v)).filter((n) => Number.isFinite(n));
        out[key] = numbers.length ? Math.min(...numbers) : null;
        continue;
      }
      if (!prefix && key === 'extraction_notes') {
        const notes = values
          .filter((n) => n != null && String(n).trim())
          .map((n) => String(n).trim());
        out[key] = notes.length ? [...new Set(notes)].join(' ') : null;
        continue;
      }
      const present = values.filter(isPresentValue);
      if (!present.length) {
        out[key] = values.find((v) => v !== undefined) ?? null;
        continue;
      }
      if (present.every(isPlainObject)) {
        out[key] = mergeLevel(present as RawAnswer[], `${prefix}${key}.`);
        continue;
      }
      out[key] = present[0];
      if (prefix !== 'field_confidence.' && present.some((v) => !sameValue(v, present[0]))) {
        conflicts.push(`${prefix}${key}`);
      }
    }
    return out;
  };

  return { data: mergeLevel(answers, ''), conflicts };
}
