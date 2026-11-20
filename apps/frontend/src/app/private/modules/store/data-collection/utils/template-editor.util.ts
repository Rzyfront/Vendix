import {
  DEFAULT_DOCUMENT_CONFIG,
  DocumentFieldConfig,
  DocumentKind,
  DOCUMENT_MAX_SIZE_MB_LIMIT,
  resolveItemDocumentConfig,
} from './template-json.contract';

/** Minimal shape the editor helpers need from a section form. */
export interface EditableSection {
  title: string;
  description: string;
  icon: string;
  sort_order: number;
  items: unknown[];
  child_sections: EditableSection[];
  expanded: boolean;
}

/** Returns a copy of `list` with the element at `from` moved to `to`. Out-of-range moves return the same content. */
export function moveInList<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length || from === to) return copy;
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

/** Reassigns `sort_order` as the position in the list (new objects, input untouched). */
export function reindexSortOrder<T extends { sort_order: number }>(list: readonly T[]): T[] {
  return list.map((entry, index) => (entry.sort_order === index ? entry : { ...entry, sort_order: index }));
}

/** Width a new field takes: short inputs share a row, long content takes the whole row. */
export function defaultItemWidth(fieldType: string | undefined): string {
  switch (fieldType) {
    case 'textarea':
    case 'file':
      return '100';
    case 'text':
    case 'email':
    case 'phone':
    case 'number':
    case 'date':
    case 'select':
    case 'url':
    case 'checkbox':
      return '50';
    default:
      return '100';
  }
}

/** Initial validation rules of a new item: documents fields start with the default config. */
export function defaultValidationRules(fieldType: string | undefined): Record<string, unknown> | null {
  if (fieldType !== 'file') return null;
  return { documents: { ...DEFAULT_DOCUMENT_CONFIG, accept: [...DEFAULT_DOCUMENT_CONFIG.accept] } };
}

/**
 * Copy of a section for "Duplicar sección". A field can appear only once per
 * template, so items are NOT copied: the copy keeps title, description, icon and
 * the structure of its subsections (also empty), ready for new fields.
 */
export function duplicateSectionStructure<S extends EditableSection>(section: S): S {
  return {
    ...section,
    id: undefined,
    title: section.title ? `${section.title} (copia)` : '',
    items: [],
    expanded: true,
    child_sections: (section.child_sections ?? []).map((child) => duplicateSectionStructure(child as S)),
  } as S;
}

/** Merges a documents-config patch into `validation_rules`, keeping other rules and bounding the values. */
export function patchDocumentsRules(
  validationRules: Record<string, unknown> | null | undefined,
  patch: Partial<DocumentFieldConfig>,
): Record<string, unknown> {
  const current = resolveItemDocumentConfig(validationRules);
  const next: DocumentFieldConfig = { ...current, ...patch };
  next.max_size_mb = Math.min(
    DOCUMENT_MAX_SIZE_MB_LIMIT,
    Math.max(1, Number.isFinite(next.max_size_mb) ? Math.round(next.max_size_mb) : current.max_size_mb),
  );
  // An empty selection would be rejected by the backend: keep the last valid kinds.
  if (!next.accept.length) next.accept = current.accept;
  return { ...(validationRules ?? {}), documents: next };
}

/** Toggles one kind in the accepted list, returning the new list (never empty). */
export function toggleAcceptedKind(accept: readonly DocumentKind[], kind: DocumentKind): DocumentKind[] {
  const next = accept.includes(kind) ? accept.filter((k) => k !== kind) : [...accept, kind];
  return next.length ? next : [...accept];
}
