import { readStoredDocuments, StoredDocument } from './template-json.contract';

/** Server answer of `POST /ecommerce/data-collection/:token/upload` (inside `data`). */
export interface UploadedDocumentResponse {
  key: string;
  url?: string | null;
  originalName?: string;
  name?: string;
  size?: number;
  mime_type?: string;
  uploaded_at?: string;
}

/** Maps the upload answer to the stored shape of a response. */
export function toStoredDocument(res: UploadedDocumentResponse, fallback: { name: string; size: number; type: string }): StoredDocument {
  return {
    key: res.key,
    name: res.name || res.originalName || fallback.name,
    size: typeof res.size === 'number' ? res.size : fallback.size,
    mime_type: res.mime_type || fallback.type,
    ...(res.uploaded_at ? { uploaded_at: res.uploaded_at } : {}),
  };
}

/**
 * Value of a documents field as the form holds it: a list of stored documents.
 * Accepts the legacy value (a single storage key string) too.
 */
export function normalizeDocumentsValue(value: unknown): StoredDocument[] {
  if (Array.isArray(value)) {
    return readStoredDocuments({ value_json: { files: value } });
  }
  if (typeof value === 'string' && value) return readStoredDocuments({ value_text: value });
  return [];
}

/**
 * Value to keep in the form for a saved response. Files with `value_json.files`
 * become the list; everything else keeps the previous precedence
 * (text, number, bool, date, json).
 */
export function restoreResponseValue(r: {
  value_text?: string | null;
  value_number?: number | null;
  value_bool?: boolean | null;
  value_date?: string | null;
  value_json?: unknown;
}): unknown {
  const json = r.value_json as { files?: unknown } | null | undefined;
  if (json && typeof json === 'object' && Array.isArray(json.files)) {
    return readStoredDocuments({ value_json: json });
  }
  return r.value_text ?? r.value_number ?? r.value_bool ?? r.value_date ?? r.value_json;
}

/**
 * Builds the response of one field for `POST …/step/:n`. Documents fields send
 * `value_text` (first key) plus `value_json = { files }` (an object, never an
 * array); a legacy single key stays as `value_text` only.
 */
export function buildFieldResponse(fieldId: number, fieldType: string, rawValue: unknown): Record<string, unknown> {
  const response: Record<string, unknown> = { field_id: fieldId };
  if (fieldType === 'number') {
    response['value_number'] = rawValue ? parseFloat(String(rawValue)) : null;
  } else if (fieldType === 'checkbox') {
    response['value_bool'] = rawValue === true || rawValue === 'true';
  } else if (fieldType === 'date') {
    response['value_date'] = rawValue || null;
  } else if (fieldType === 'file' && Array.isArray(rawValue)) {
    const files = normalizeDocumentsValue(rawValue);
    response['value_text'] = files[0]?.key ?? null;
    response['value_json'] = { files };
  } else {
    response['value_text'] = rawValue?.toString() || null;
  }
  return response;
}

/**
 * List after an upload: appended when the field takes several files (up to
 * `maxFiles`), otherwise the new file replaces the previous one.
 */
export function addUploadedDocument(
  current: readonly StoredDocument[],
  uploaded: StoredDocument,
  multiple: boolean,
  maxFiles: number,
): StoredDocument[] {
  if (!multiple) return [uploaded];
  return [...current, uploaded].slice(0, maxFiles);
}

/**
 * `value_text` + `value_json` of a documents answer in the CRM sheet. An empty
 * list sends all-null values, which deletes the answer.
 */
export function documentsToValueInput(files: readonly StoredDocument[]): {
  value_text: string | null;
  value_json: { files: StoredDocument[] } | null;
} {
  if (!files.length) return { value_text: null, value_json: null };
  const clean = files.map((f) => ({
    key: f.key,
    name: f.name,
    size: f.size,
    mime_type: f.mime_type,
    ...(f.uploaded_at ? { uploaded_at: f.uploaded_at } : {}),
  }));
  return { value_text: clean[0].key, value_json: { files: clean } };
}
