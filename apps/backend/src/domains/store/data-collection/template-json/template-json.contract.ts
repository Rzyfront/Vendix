/**
 * vendix.data-collection-template/v1 — portable JSON of a data collection
 * template, plus the policy of the "Documentos / adjuntos" field.
 *
 * Two byte-identical copies (no executable shared package between runtimes):
 *   - apps/backend/src/domains/store/data-collection/template-json/template-json.contract.ts (canonical)
 *   - apps/frontend/src/app/private/modules/store/data-collection/utils/template-json.contract.ts
 * Parity is enforced by template-json.contract.parity.spec.ts. Edit the
 * canonical copy and copy it over; never edit only one side.
 *
 * Pure TypeScript: no imports, no I/O. The backend validates every import with
 * `validateTemplateJson` (the client is never trusted); the frontend uses the
 * same function to preview errors before sending.
 */

export const TEMPLATE_JSON_SCHEMA_ID = 'vendix.data-collection-template/v1';

export const TEMPLATE_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'select',
  'checkbox',
  'textarea',
  'file',
  'email',
  'phone',
  'url',
] as const;
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

export const TEMPLATE_ENTITY_TYPES = [
  'customer',
  'booking',
  'order',
  'service_session',
] as const;
export type TemplateEntityType = (typeof TEMPLATE_ENTITY_TYPES)[number];

export const TEMPLATE_ITEM_WIDTHS = ['25', '33', '50', '75', '100'] as const;
export type TemplateItemWidth = (typeof TEMPLATE_ITEM_WIDTHS)[number];

/** Limits of one import, to keep a pasted JSON from creating thousands of rows. */
export const TEMPLATE_JSON_LIMITS = {
  maxTabs: 20,
  maxSections: 60,
  maxItems: 300,
  maxSelectOptions: 200,
  maxTextLength: 255,
  maxKeyLength: 100,
} as const;

// ---------------------------------------------------------------------------
// Documents / attachments field (field_type = 'file')
// ---------------------------------------------------------------------------

/**
 * File kinds an administrator can allow, by MIME type with the extensions that
 * type may carry. Anything else (SVG, HTML, scripts, archives) is refused:
 * files are served from S3 with their content type.
 */
export const DOCUMENT_KINDS = {
  pdf: {
    label: 'PDF',
    mimes: { 'application/pdf': ['pdf'] },
  },
  image: {
    label: 'Imágenes (JPG, PNG, WEBP, GIF)',
    mimes: {
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'image/webp': ['webp'],
      'image/gif': ['gif'],
    },
  },
  word: {
    label: 'Word',
    mimes: {
      'application/msword': ['doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    },
  },
  excel: {
    label: 'Excel / CSV',
    mimes: {
      // Windows with Excel installed sends .csv files with the Excel type.
      'application/vnd.ms-excel': ['xls', 'csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
      'text/csv': ['csv'],
    },
  },
  powerpoint: {
    label: 'PowerPoint',
    mimes: {
      'application/vnd.ms-powerpoint': ['ppt'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
    },
  },
  text: {
    label: 'Texto (.txt)',
    mimes: { 'text/plain': ['txt'] },
  },
} as const satisfies Record<string, { label: string; mimes: Record<string, readonly string[]> }>;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;
export const DOCUMENT_KIND_KEYS = Object.keys(DOCUMENT_KINDS) as DocumentKind[];

/** Absolute ceiling per file, whatever the template says. */
export const DOCUMENT_MAX_SIZE_MB_LIMIT = 20;
/** Most files one documents field accepts when `multiple` is on. */
export const DOCUMENT_MAX_FILES = 10;

/**
 * Configuration of a documents field inside a template. Stored in
 * `data_collection_items.validation_rules.documents`.
 */
export interface DocumentFieldConfig {
  multiple: boolean;
  accept: DocumentKind[];
  max_size_mb: number;
}

export const DEFAULT_DOCUMENT_CONFIG: DocumentFieldConfig = {
  multiple: false,
  accept: ['pdf', 'image'],
  max_size_mb: 10,
};

/**
 * One stored attachment. `entity_metadata_values.value_json = { files: [...] }`
 * and `value_text` keeps the first key, so readers that only know the legacy
 * single-file shape keep working.
 */
export interface StoredDocument {
  key: string;
  name: string;
  size: number;
  mime_type: string;
  uploaded_at?: string;
}

/** Reads `validation_rules.documents`, filling defaults and dropping invalid values. */
export function resolveDocumentConfig(validationRules: unknown): DocumentFieldConfig {
  const raw = isPlainObject(validationRules) ? validationRules['documents'] : undefined;
  if (!isPlainObject(raw)) return { ...DEFAULT_DOCUMENT_CONFIG, accept: [...DEFAULT_DOCUMENT_CONFIG.accept] };
  const accept = Array.isArray(raw['accept'])
    ? (raw['accept'].filter((k) => typeof k === 'string' && k in DOCUMENT_KINDS) as DocumentKind[])
    : [];
  const size = typeof raw['max_size_mb'] === 'number' && Number.isFinite(raw['max_size_mb']) ? raw['max_size_mb'] : NaN;
  return {
    multiple: raw['multiple'] === true,
    accept: accept.length ? Array.from(new Set(accept)) : [...DEFAULT_DOCUMENT_CONFIG.accept],
    max_size_mb:
      size > 0 ? Math.min(size, DOCUMENT_MAX_SIZE_MB_LIMIT) : DEFAULT_DOCUMENT_CONFIG.max_size_mb,
  };
}

/** Allowed MIME → extensions of a configuration. */
export function allowedMimes(config: DocumentFieldConfig): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const kind of config.accept) {
    const mimes: Record<string, readonly string[]> = DOCUMENT_KINDS[kind].mimes;
    for (const [mime, exts] of Object.entries(mimes)) {
      out[mime] = Array.from(new Set([...(out[mime] ?? []), ...exts]));
    }
  }
  return out;
}

/** Value for an `<input type="file" accept>` attribute. */
export function documentAcceptAttribute(config: DocumentFieldConfig): string {
  const mimes = allowedMimes(config);
  const exts = Array.from(new Set(Object.values(mimes).flat())).map((e) => `.${e}`);
  return [...Object.keys(mimes), ...exts].join(',');
}

/**
 * Checks one file against a configuration by MIME type, extension and size.
 * Returns a user-facing Spanish message, or null when the file is accepted.
 */
export function checkDocumentFile(
  config: DocumentFieldConfig,
  file: { name: string; mime_type: string; size: number },
): string | null {
  const name = file.name || '';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const mime = (file.mime_type || '').toLowerCase();
  const allowed = allowedMimes(config);
  if (!ext || !allowed[mime]?.includes(ext)) {
    const kinds = config.accept.map((k) => DOCUMENT_KINDS[k].label).join(', ');
    return `Tipo de archivo no permitido. Este campo acepta: ${kinds}.`;
  }
  if (!(file.size > 0)) return 'El archivo está vacío.';
  if (file.size > config.max_size_mb * 1024 * 1024) {
    return `El archivo supera el tamaño máximo de ${config.max_size_mb} MB.`;
  }
  return null;
}

/**
 * Reads the attachments of a stored value: `value_json.files`, or the legacy
 * single key in `value_text`.
 */
export function readStoredDocuments(value: {
  value_text?: string | null;
  value_json?: unknown;
}): StoredDocument[] {
  const json = value.value_json;
  if (isPlainObject(json) && Array.isArray(json['files'])) {
    return json['files']
      .filter((f): f is Record<string, unknown> => isPlainObject(f) && typeof f['key'] === 'string' && !!f['key'])
      .map((f) => ({
        key: f['key'] as string,
        name: typeof f['name'] === 'string' && f['name'] ? f['name'] : basename(f['key'] as string),
        size: typeof f['size'] === 'number' ? f['size'] : 0,
        mime_type: typeof f['mime_type'] === 'string' ? f['mime_type'] : '',
        ...(typeof f['uploaded_at'] === 'string' ? { uploaded_at: f['uploaded_at'] } : {}),
      }));
  }
  if (typeof value.value_text === 'string' && value.value_text) {
    return [{ key: value.value_text, name: basename(value.value_text), size: 0, mime_type: '' }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Portable template JSON
// ---------------------------------------------------------------------------

export interface TemplateJsonField {
  /** Stable key of the field in the store (`entity_metadata_fields.field_key`). */
  key: string;
  type: TemplateFieldType;
  label: string;
  /** Entity the answer belongs to; defaults to the template's entity_type. */
  entity_type?: TemplateEntityType;
  description?: string;
  /** Only for `select`. */
  options?: string[];
}

export interface TemplateJsonItem {
  field: TemplateJsonField;
  required?: boolean;
  include_in_summary?: boolean;
  help_text?: string;
  placeholder?: string;
  width?: TemplateItemWidth;
  icon?: string;
  /** Only for `file` fields. */
  documents?: DocumentFieldConfig;
}

export interface TemplateJsonSection {
  title: string;
  description?: string;
  icon?: string;
  items?: TemplateJsonItem[];
  /** One level of nesting; child sections cannot have children. */
  child_sections?: TemplateJsonSection[];
}

export interface TemplateJsonTab {
  title: string;
  icon?: string;
  sections: TemplateJsonSection[];
}

export interface TemplateJson {
  schema: typeof TEMPLATE_JSON_SCHEMA_ID;
  name: string;
  description?: string;
  icon?: string;
  entity_type: TemplateEntityType;
  /** Either `tabs` (steps) or `sections`, never both. */
  tabs?: TemplateJsonTab[];
  sections?: TemplateJsonSection[];
}

export interface TemplateJsonError {
  /** Location in the JSON, e.g. `sections[0].items[2].field.type`. */
  path: string;
  message: string;
}

export type TemplateJsonValidation =
  | { ok: true; value: TemplateJson; errors: TemplateJsonError[] }
  | { ok: false; errors: TemplateJsonError[] };

/**
 * Validates and normalizes a template JSON. Unknown keys, internal ids
 * (`id`, `template_id`, `metadata_field_id`, …) are dropped: an import always
 * creates new records in the store of the request.
 */
export function validateTemplateJson(input: unknown): TemplateJsonValidation {
  const errors: TemplateJsonError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ path: '', message: 'El JSON debe ser un objeto con la plantilla.' }] };
  }

  if (input['schema'] !== undefined && input['schema'] !== TEMPLATE_JSON_SCHEMA_ID) {
    err('schema', `Esquema no soportado. Usa "${TEMPLATE_JSON_SCHEMA_ID}".`);
  }

  const name = requiredText(input['name'], 'name', 'El nombre de la plantilla', err);
  const description = optionalText(input['description'], 'description', err, 5000);
  const icon = optionalText(input['icon'], 'icon', err, 100);

  let entityType: TemplateEntityType = 'booking';
  if (input['entity_type'] !== undefined) {
    if (isOneOf(input['entity_type'], TEMPLATE_ENTITY_TYPES)) entityType = input['entity_type'];
    else err('entity_type', `Tipo de entidad no válido. Usa uno de: ${TEMPLATE_ENTITY_TYPES.join(', ')}.`);
  }

  const counters = { sections: 0, items: 0 };
  const seenFields = new Map<string, { type: string; path: string }>();
  const ctx: SectionCtx = { entityType, err, counters, seenFields };

  const hasTabs = Array.isArray(input['tabs']) && input['tabs'].length > 0;
  const hasSections = Array.isArray(input['sections']) && input['sections'].length > 0;
  if (input['tabs'] !== undefined && !Array.isArray(input['tabs'])) err('tabs', 'tabs debe ser una lista.');
  if (input['sections'] !== undefined && !Array.isArray(input['sections'])) err('sections', 'sections debe ser una lista.');

  let tabs: TemplateJsonTab[] | undefined;
  let sections: TemplateJsonSection[] | undefined;

  if (hasTabs && hasSections) {
    err('tabs', 'Usa "tabs" (pasos) o "sections", no ambos.');
  } else if (hasTabs) {
    const rawTabs = input['tabs'] as unknown[];
    if (rawTabs.length > TEMPLATE_JSON_LIMITS.maxTabs) {
      err('tabs', `Máximo ${TEMPLATE_JSON_LIMITS.maxTabs} pasos.`);
    }
    tabs = rawTabs.slice(0, TEMPLATE_JSON_LIMITS.maxTabs).map((rawTab, t) => {
      const p = `tabs[${t}]`;
      if (!isPlainObject(rawTab)) {
        err(p, 'Cada paso debe ser un objeto.');
        return { title: '', sections: [] };
      }
      const title = requiredText(rawTab['title'], `${p}.title`, 'El título del paso', err);
      const tabIcon = optionalText(rawTab['icon'], `${p}.icon`, err, 100);
      const rawSections = rawTab['sections'];
      if (!Array.isArray(rawSections) || rawSections.length === 0) {
        err(`${p}.sections`, 'Cada paso necesita al menos una sección.');
      }
      const tabSections = Array.isArray(rawSections)
        ? rawSections.map((s, i) => parseSection(s, `${p}.sections[${i}]`, ctx, true))
        : [];
      return { title, ...(tabIcon ? { icon: tabIcon } : {}), sections: tabSections };
    });
  } else if (hasSections) {
    sections = (input['sections'] as unknown[]).map((s, i) => parseSection(s, `sections[${i}]`, ctx, true));
  } else {
    err('sections', 'La plantilla necesita al menos una sección (o un paso en "tabs").');
  }

  if (counters.sections > TEMPLATE_JSON_LIMITS.maxSections) {
    err('sections', `Máximo ${TEMPLATE_JSON_LIMITS.maxSections} secciones en total.`);
  }
  if (counters.items > TEMPLATE_JSON_LIMITS.maxItems) {
    err('sections', `Máximo ${TEMPLATE_JSON_LIMITS.maxItems} campos en total.`);
  }

  if (errors.length) return { ok: false, errors };

  const value: TemplateJson = {
    schema: TEMPLATE_JSON_SCHEMA_ID,
    name,
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    entity_type: entityType,
    ...(tabs ? { tabs } : {}),
    ...(sections ? { sections } : {}),
  };
  return { ok: true, value, errors: [] };
}

interface SectionCtx {
  entityType: TemplateEntityType;
  err: (path: string, message: string) => void;
  counters: { sections: number; items: number };
  seenFields: Map<string, { type: string; path: string }>;
}

function parseSection(raw: unknown, p: string, ctx: SectionCtx, allowChildren: boolean): TemplateJsonSection {
  ctx.counters.sections++;
  if (!isPlainObject(raw)) {
    ctx.err(p, 'Cada sección debe ser un objeto.');
    return { title: '' };
  }
  const title = requiredText(raw['title'], `${p}.title`, 'El título de la sección', ctx.err);
  const description = optionalText(raw['description'], `${p}.description`, ctx.err, 5000);
  const icon = optionalText(raw['icon'], `${p}.icon`, ctx.err, 100);

  let items: TemplateJsonItem[] = [];
  if (raw['items'] !== undefined) {
    if (!Array.isArray(raw['items'])) ctx.err(`${p}.items`, 'items debe ser una lista.');
    else items = raw['items'].map((it, i) => parseItem(it, `${p}.items[${i}]`, ctx));
  }

  let children: TemplateJsonSection[] = [];
  if (raw['child_sections'] !== undefined) {
    if (!allowChildren) {
      ctx.err(`${p}.child_sections`, 'Solo se permite un nivel de subsecciones.');
    } else if (!Array.isArray(raw['child_sections'])) {
      ctx.err(`${p}.child_sections`, 'child_sections debe ser una lista.');
    } else {
      children = raw['child_sections'].map((c, i) => parseSection(c, `${p}.child_sections[${i}]`, ctx, false));
    }
  }

  return {
    title,
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    items,
    ...(children.length ? { child_sections: children } : {}),
  };
}

function parseItem(raw: unknown, p: string, ctx: SectionCtx): TemplateJsonItem {
  ctx.counters.items++;
  const fallback: TemplateJsonItem = { field: { key: '', type: 'text', label: '' } };
  if (!isPlainObject(raw)) {
    ctx.err(p, 'Cada campo debe ser un objeto.');
    return fallback;
  }
  const rawField = raw['field'];
  if (!isPlainObject(rawField)) {
    ctx.err(`${p}.field`, 'Falta "field" con key, type y label.');
    return fallback;
  }
  const fp = `${p}.field`;

  let key = '';
  if (typeof rawField['key'] !== 'string' || !rawField['key'].trim()) {
    ctx.err(`${fp}.key`, 'La clave del campo es obligatoria (ej. "placa").');
  } else if (!/^[A-Za-z0-9_.-]+$/.test(rawField['key'].trim())) {
    ctx.err(`${fp}.key`, 'La clave solo puede tener letras, números, "_", "-" y "." (sin espacios).');
  } else if (rawField['key'].trim().length > TEMPLATE_JSON_LIMITS.maxKeyLength) {
    ctx.err(`${fp}.key`, `La clave admite máximo ${TEMPLATE_JSON_LIMITS.maxKeyLength} caracteres.`);
  } else {
    key = rawField['key'].trim();
  }

  let type: TemplateFieldType = 'text';
  if (isOneOf(rawField['type'], TEMPLATE_FIELD_TYPES)) type = rawField['type'];
  else {
    ctx.err(
      `${fp}.type`,
      `Tipo de campo no válido${typeof rawField['type'] === 'string' ? `: "${rawField['type']}"` : ''}. Usa uno de: ${TEMPLATE_FIELD_TYPES.join(', ')}.`,
    );
  }

  const label = requiredText(rawField['label'], `${fp}.label`, 'La etiqueta del campo', ctx.err);
  const fieldDescription = optionalText(rawField['description'], `${fp}.description`, ctx.err, 5000);

  let entityType: TemplateEntityType = ctx.entityType;
  if (rawField['entity_type'] !== undefined) {
    if (isOneOf(rawField['entity_type'], TEMPLATE_ENTITY_TYPES)) entityType = rawField['entity_type'];
    else ctx.err(`${fp}.entity_type`, `Tipo de entidad no válido. Usa uno de: ${TEMPLATE_ENTITY_TYPES.join(', ')}.`);
  }

  let options: string[] | undefined;
  if (type === 'select') {
    const rawOptions = rawField['options'];
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      ctx.err(`${fp}.options`, 'Una lista de opciones necesita "options" con al menos una opción.');
    } else if (rawOptions.length > TEMPLATE_JSON_LIMITS.maxSelectOptions) {
      ctx.err(`${fp}.options`, `Máximo ${TEMPLATE_JSON_LIMITS.maxSelectOptions} opciones.`);
    } else if (rawOptions.some((o) => typeof o !== 'string' || !o.trim())) {
      ctx.err(`${fp}.options`, 'Cada opción debe ser un texto no vacío.');
    } else {
      options = Array.from(new Set((rawOptions as string[]).map((o) => o.trim())));
    }
  }

  if (key) {
    const seenKey = `${entityType}:${key}`;
    const seen = ctx.seenFields.get(seenKey);
    if (seen) {
      ctx.err(`${fp}.key`, `La clave "${key}" ya se usa en ${seen.path}; cada campo va una sola vez por plantilla.`);
    } else {
      ctx.seenFields.set(seenKey, { type, path: p });
    }
  }

  const helpText = optionalText(raw['help_text'], `${p}.help_text`, ctx.err, 5000);
  const placeholder = optionalText(raw['placeholder'], `${p}.placeholder`, ctx.err, TEMPLATE_JSON_LIMITS.maxTextLength);
  const icon = optionalText(raw['icon'], `${p}.icon`, ctx.err, 100);

  let width: TemplateItemWidth | undefined;
  if (raw['width'] !== undefined && raw['width'] !== null) {
    const w = String(raw['width']);
    if (isOneOf(w, TEMPLATE_ITEM_WIDTHS)) width = w;
    else ctx.err(`${p}.width`, `Ancho no válido. Usa uno de: ${TEMPLATE_ITEM_WIDTHS.join(', ')}.`);
  }

  const required = optionalBool(raw['required'], `${p}.required`, ctx.err);
  const inSummary = optionalBool(raw['include_in_summary'], `${p}.include_in_summary`, ctx.err);

  let documents: DocumentFieldConfig | undefined;
  if (raw['documents'] !== undefined) {
    if (type !== 'file') {
      ctx.err(`${p}.documents`, '"documents" solo aplica a campos de tipo "file".');
    } else {
      documents = parseDocuments(raw['documents'], `${p}.documents`, ctx.err);
    }
  } else if (type === 'file') {
    documents = resolveDocumentConfig(undefined);
  }

  return {
    field: {
      key,
      type,
      label,
      ...(entityType !== ctx.entityType ? { entity_type: entityType } : {}),
      ...(fieldDescription ? { description: fieldDescription } : {}),
      ...(options ? { options } : {}),
    },
    ...(required !== undefined ? { required } : {}),
    ...(inSummary !== undefined ? { include_in_summary: inSummary } : {}),
    ...(helpText ? { help_text: helpText } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(width ? { width } : {}),
    ...(icon ? { icon } : {}),
    ...(documents ? { documents } : {}),
  };
}

function parseDocuments(raw: unknown, p: string, err: (path: string, message: string) => void): DocumentFieldConfig {
  if (!isPlainObject(raw)) {
    err(p, '"documents" debe ser un objeto con multiple, accept y max_size_mb.');
    return resolveDocumentConfig(undefined);
  }
  if (raw['multiple'] !== undefined && typeof raw['multiple'] !== 'boolean') {
    err(`${p}.multiple`, 'multiple debe ser true o false.');
  }
  if (raw['accept'] !== undefined) {
    if (!Array.isArray(raw['accept']) || raw['accept'].length === 0) {
      err(`${p}.accept`, `accept debe ser una lista con al menos uno de: ${DOCUMENT_KIND_KEYS.join(', ')}.`);
    } else {
      const bad = raw['accept'].filter((k) => typeof k !== 'string' || !(k in DOCUMENT_KINDS));
      if (bad.length) {
        err(`${p}.accept`, `Tipos de archivo no válidos: ${bad.map(String).join(', ')}. Usa: ${DOCUMENT_KIND_KEYS.join(', ')}.`);
      }
    }
  }
  if (raw['max_size_mb'] !== undefined) {
    const v = raw['max_size_mb'];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > DOCUMENT_MAX_SIZE_MB_LIMIT) {
      err(`${p}.max_size_mb`, `max_size_mb debe ser un número entre 1 y ${DOCUMENT_MAX_SIZE_MB_LIMIT}.`);
    }
  }
  return resolveDocumentConfig({ documents: raw });
}

// ---------------------------------------------------------------------------
// Export and example
// ---------------------------------------------------------------------------

/** Minimal shape of a loaded template (`GET /store/data-collection/templates/:id`). */
export interface TemplateLike {
  name: string;
  description?: string | null;
  icon?: string | null;
  entity_type: string;
  tabs?: { title: string; icon?: string | null; sort_order?: number; sections?: SectionLike[] }[] | null;
  sections?: SectionLike[] | null;
}
export interface SectionLike {
  title: string;
  description?: string | null;
  icon?: string | null;
  sort_order?: number;
  items?: ItemLike[] | null;
  child_sections?: SectionLike[] | null;
}
export interface ItemLike {
  sort_order?: number;
  is_required?: boolean | null;
  include_in_summary?: boolean | null;
  help_text?: string | null;
  placeholder?: string | null;
  width?: string | null;
  icon?: string | null;
  validation_rules?: unknown;
  metadata_field?: {
    field_key: string;
    field_type: string;
    label: string;
    entity_type: string;
    description?: string | null;
    options?: unknown;
  } | null;
}

/** Converts a loaded template into portable JSON, without any internal id. */
export function templateToJson(template: TemplateLike): TemplateJson {
  const entityType = (isOneOf(template.entity_type, TEMPLATE_ENTITY_TYPES)
    ? template.entity_type
    : 'booking') as TemplateEntityType;
  const bySort = <T extends { sort_order?: number }>(list: T[] | null | undefined): T[] =>
    [...(list ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const mapItem = (item: ItemLike): TemplateJsonItem | null => {
    const f = item.metadata_field;
    if (!f) return null;
    const type = (isOneOf(f.field_type, TEMPLATE_FIELD_TYPES) ? f.field_type : 'text') as TemplateFieldType;
    const options = Array.isArray(f.options)
      ? f.options.filter((o): o is string => typeof o === 'string')
      : isPlainObject(f.options) && Array.isArray(f.options['items'])
        ? (f.options['items'] as unknown[]).filter((o): o is string => typeof o === 'string')
        : undefined;
    return {
      field: {
        key: f.field_key,
        type,
        label: f.label,
        ...(f.entity_type !== entityType ? { entity_type: f.entity_type as TemplateEntityType } : {}),
        ...(f.description ? { description: f.description } : {}),
        ...(type === 'select' && options?.length ? { options } : {}),
      },
      ...(item.is_required ? { required: true } : {}),
      ...(item.include_in_summary ? { include_in_summary: true } : {}),
      ...(item.help_text ? { help_text: item.help_text } : {}),
      ...(item.placeholder ? { placeholder: item.placeholder } : {}),
      ...(item.width && isOneOf(item.width, TEMPLATE_ITEM_WIDTHS) ? { width: item.width } : {}),
      ...(item.icon ? { icon: item.icon } : {}),
      ...(type === 'file' ? { documents: resolveDocumentConfig(item.validation_rules) } : {}),
    };
  };

  const mapSection = (s: SectionLike): TemplateJsonSection => {
    const children = bySort(s.child_sections).map(mapSection);
    return {
      title: s.title,
      ...(s.description ? { description: s.description } : {}),
      ...(s.icon ? { icon: s.icon } : {}),
      items: bySort(s.items)
        .map(mapItem)
        .filter((i): i is TemplateJsonItem => i !== null),
      ...(children.length ? { child_sections: children } : {}),
    };
  };

  const tabs = bySort(template.tabs ?? []);
  return {
    schema: TEMPLATE_JSON_SCHEMA_ID,
    name: template.name,
    ...(template.description ? { description: template.description } : {}),
    ...(template.icon ? { icon: template.icon } : {}),
    entity_type: entityType,
    ...(tabs.length
      ? { tabs: tabs.map((t) => ({ title: t.title, ...(t.icon ? { icon: t.icon } : {}), sections: bySort(t.sections).map(mapSection) })) }
      : { sections: bySort(template.sections).map(mapSection) }),
  };
}

/** Example JSON with every field type, including documents. Always valid. */
export function buildExampleTemplateJson(): TemplateJson {
  return {
    schema: TEMPLATE_JSON_SCHEMA_ID,
    name: 'Ficha de ingreso (ejemplo)',
    description: 'Plantilla de ejemplo con todos los tipos de campo.',
    entity_type: 'booking',
    sections: [
      {
        title: 'Datos del cliente',
        items: [
          { field: { key: 'ejemplo_nombre', type: 'text', label: 'Nombre completo', entity_type: 'customer' }, required: true, width: '50', placeholder: 'Ej. Ana Pérez' },
          { field: { key: 'ejemplo_correo', type: 'email', label: 'Correo', entity_type: 'customer' }, width: '50' },
          { field: { key: 'ejemplo_telefono', type: 'phone', label: 'Teléfono', entity_type: 'customer' }, width: '50' },
          { field: { key: 'ejemplo_nacimiento', type: 'date', label: 'Fecha de nacimiento', entity_type: 'customer' }, width: '50' },
        ],
      },
      {
        title: 'Detalle del servicio',
        description: 'Lo que el cliente nos cuenta antes de la cita.',
        items: [
          { field: { key: 'ejemplo_motivo', type: 'select', label: 'Motivo de la visita', options: ['Primera vez', 'Control', 'Urgencia'] }, required: true, width: '50' },
          { field: { key: 'ejemplo_visitas', type: 'number', label: 'Visitas previas' }, width: '50' },
          { field: { key: 'ejemplo_observaciones', type: 'textarea', label: 'Observaciones' }, help_text: 'Cuéntanos lo que debamos saber.', width: '100' },
          { field: { key: 'ejemplo_referencia', type: 'url', label: 'Enlace de referencia' }, width: '50' },
          { field: { key: 'ejemplo_acepta', type: 'checkbox', label: 'Acepto el tratamiento de datos' }, required: true, width: '50' },
        ],
      },
      {
        title: 'Documentos',
        items: [
          {
            field: { key: 'ejemplo_documentos', type: 'file', label: 'Documentos de soporte' },
            help_text: 'Sube la cédula y la orden médica (PDF o foto).',
            width: '100',
            documents: { multiple: true, accept: ['pdf', 'image'], max_size_mb: 10 },
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isOneOf<T extends string>(v: unknown, list: readonly T[]): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

function basename(key: string): string {
  const last = key.split('/').pop() || key;
  // Uploaded keys are `<timestamp>-<name>`.
  return last.replace(/^\d{10,}-/, '');
}

function requiredText(
  v: unknown,
  path: string,
  what: string,
  err: (path: string, message: string) => void,
): string {
  if (typeof v !== 'string' || !v.trim()) {
    err(path, `${what} es obligatorio.`);
    return '';
  }
  if (v.trim().length > TEMPLATE_JSON_LIMITS.maxTextLength) {
    err(path, `${what} admite máximo ${TEMPLATE_JSON_LIMITS.maxTextLength} caracteres.`);
    return '';
  }
  return v.trim();
}

function optionalText(
  v: unknown,
  path: string,
  err: (path: string, message: string) => void,
  max: number,
): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') {
    err(path, 'Debe ser un texto.');
    return undefined;
  }
  if (v.length > max) {
    err(path, `Admite máximo ${max} caracteres.`);
    return undefined;
  }
  return v.trim() || undefined;
}

function optionalBool(
  v: unknown,
  path: string,
  err: (path: string, message: string) => void,
): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') {
    err(path, 'Debe ser true o false.');
    return undefined;
  }
  return v;
}
