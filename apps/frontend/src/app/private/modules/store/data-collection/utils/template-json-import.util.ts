import { DOCUMENT_KINDS, TemplateJson, TemplateJsonSection } from './template-json.contract';

export type ParsedJsonText =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/**
 * Parses pasted/uploaded text as JSON, returning a Spanish message with line
 * and column when the syntax is wrong (instead of the raw engine message).
 */
export function parseTemplateJsonText(text: string): ParsedJsonText {
  const clean = (text ?? '').replace(/^﻿/, '');
  if (!clean.trim()) return { ok: false, message: 'Pega el JSON de la plantilla o sube un archivo .json.' };
  try {
    return { ok: true, value: JSON.parse(clean) as unknown };
  } catch (e) {
    const raw = e instanceof Error ? e.message : '';
    const posMatch = /position (\d+)/i.exec(raw);
    if (posMatch) {
      const pos = Math.min(Number(posMatch[1]), clean.length);
      const before = clean.slice(0, pos);
      const line = before.split('\n').length;
      const column = pos - (before.lastIndexOf('\n') + 1) + 1;
      return { ok: false, message: `El JSON no es válido: error de sintaxis en la línea ${line}, columna ${column}.` };
    }
    const lineMatch = /line (\d+) column (\d+)/i.exec(raw);
    if (lineMatch) {
      return {
        ok: false,
        message: `El JSON no es válido: error de sintaxis en la línea ${lineMatch[1]}, columna ${lineMatch[2]}.`,
      };
    }
    return { ok: false, message: 'El JSON no es válido: revisa comas, comillas y llaves.' };
  }
}

/** `Mi plantilla ÚNICA` → `mi-plantilla-unica.json` */
export function templateJsonFilename(name: string | null | undefined): string {
  const slug = (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'plantilla'}.json`;
}

/** `{path, message}` → `sections[0].items[2].field.type: mensaje` (empty path → only the message). */
export function formatJsonError(error: { path: string; message: string }): string {
  return error.path ? `${error.path}: ${error.message}` : error.message;
}

export interface SummaryField {
  label: string;
  type: string;
  required: boolean;
  /** Human description of a documents field (kinds, multiple, size). */
  documents?: string;
}

export interface SummarySection {
  title: string;
  depth: number;
  fields: SummaryField[];
}

export interface SummaryStep {
  title: string;
  sections: SummarySection[];
}

export interface TemplateJsonSummary {
  name: string;
  entity_type: string;
  steps: SummaryStep[];
  total_sections: number;
  total_fields: number;
}

function describeDocuments(item: NonNullable<TemplateJsonSection['items']>[number]): string | undefined {
  const docs = item.documents;
  if (!docs) return undefined;
  const kinds = docs.accept.map((k) => DOCUMENT_KINDS[k]?.label ?? k).join(', ');
  return `${docs.multiple ? 'Varios archivos' : 'Un archivo'} · ${kinds} · hasta ${docs.max_size_mb} MB`;
}

/** Flattens a section and its subsections into preview rows. */
function flattenSection(section: TemplateJsonSection, depth: number, out: SummarySection[]): void {
  out.push({
    title: section.title,
    depth,
    fields: (section.items ?? []).map((item) => ({
      label: item.field.label,
      type: item.field.type,
      required: item.required === true,
      ...(describeDocuments(item) ? { documents: describeDocuments(item) } : {}),
    })),
  });
  for (const child of section.child_sections ?? []) flattenSection(child, depth + 1, out);
}

/** Structure preview of a validated template JSON (steps → sections → fields). */
export function summarizeTemplateJson(json: TemplateJson): TemplateJsonSummary {
  const steps: SummaryStep[] = [];
  const build = (title: string, sections: TemplateJsonSection[]): SummaryStep => {
    const rows: SummarySection[] = [];
    for (const s of sections) flattenSection(s, 0, rows);
    return { title, sections: rows };
  };
  if (json.tabs?.length) {
    for (const tab of json.tabs) steps.push(build(tab.title, tab.sections ?? []));
  } else {
    steps.push(build('Formulario', json.sections ?? []));
  }
  const allSections = steps.flatMap((s) => s.sections);
  return {
    name: json.name,
    entity_type: json.entity_type,
    steps,
    total_sections: allSections.length,
    total_fields: allSections.reduce((sum, s) => sum + s.fields.length, 0),
  };
}

export interface ImportServerError {
  message: string;
  errors: { path: string; message: string }[];
}

/**
 * Reads a failed import response (`422 DCOL_IMPORT_001` with
 * `details.errors: [{path, message}]`, or any other error) into a message plus
 * the per-path errors.
 */
export function readImportServerError(err: unknown): ImportServerError {
  const root = (err as { error?: unknown } | null)?.error ?? err;
  const body = (root as { error?: unknown } | null)?.error && typeof (root as { error?: unknown }).error === 'object'
    ? (root as { error: Record<string, unknown> }).error
    : (root as Record<string, unknown> | null);
  const details = (body?.['details'] ?? {}) as { errors?: unknown };
  const errors = Array.isArray(details.errors)
    ? details.errors
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e) => ({
          path: typeof e['path'] === 'string' ? e['path'] : '',
          message: typeof e['message'] === 'string' ? e['message'] : 'Valor no válido.',
        }))
    : [];
  const rawMessage = body?.['message'];
  const message =
    typeof rawMessage === 'string' && rawMessage
      ? rawMessage
      : Array.isArray(rawMessage) && rawMessage.length
        ? rawMessage.map(String).join(' ')
        : 'No se pudo importar la plantilla. Inténtalo de nuevo.';
  return { message, errors };
}
