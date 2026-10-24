import {
  requirementsFor,
  type FiscalDocumentType,
} from './fiscal-document-requirements';

/**
 * Qué numeración toma HOY el generador de consecutivos, por tipo de documento.
 * Espejo de `GET {rail}/resolutions/in-use`.
 */
export interface ResolutionInUse {
  document_type: FiscalDocumentType;
  source: 'resolution' | 'internal_series_projected' | 'none';
  resolution_id: number | null;
  prefix: string | null;
  resolution_number: string | null;
  next_number: string | null;
  /** ISO. */
  valid_to: string | null;
  is_internal_series: boolean;
  /** Activas y vigentes de ese tipo. */
  active_count: number;
  /** `true` en los tipos de nota: solo una serie activa por entidad contable. */
  single_active_enforced: boolean;
}

export interface ResolutionsInUseResponse {
  accounting_entity_id: number;
  items: ResolutionInUse[];
}

/** Tipos de nota: una sola serie activa por entidad contable. */
export const NOTE_SERIES_DOCUMENT_TYPES = [
  'credit_note',
  'debit_note',
  'support_adjustment_note',
  'equivalent_adjustment_note',
] as const satisfies readonly FiscalDocumentType[];

export function isNoteSeriesType(value: unknown): value is FiscalDocumentType {
  return (NOTE_SERIES_DOCUMENT_TYPES as readonly unknown[]).includes(value);
}

/** Forma mínima de una fila de resolución para detectar conflictos de serie. */
export interface NoteSeriesRow {
  id: number;
  prefix?: string | null;
  document_type?: string | null;
  is_active: boolean;
  accounting_entity_id?: number | null;
}

/**
 * Filas activas de OTRA resolución del mismo tipo de nota y la misma entidad
 * contable. Si el backend activa `candidate`, desactivará estas.
 *
 * `candidate.id` es `null` en un alta. Cuando ambas filas traen
 * `accounting_entity_id` deben coincidir; si alguna no lo trae se asume la
 * misma entidad (las listas de tienda y de la consola de tenant ya son de una
 * sola entidad).
 */
export function findNoteSeriesConflicts(
  rows: readonly NoteSeriesRow[],
  candidate: {
    id: number | null;
    document_type: string | null | undefined;
    accounting_entity_id?: number | null;
  },
): NoteSeriesRow[] {
  if (!isNoteSeriesType(candidate.document_type)) return [];
  return rows.filter((row) => {
    if (!row.is_active) return false;
    if (candidate.id !== null && row.id === candidate.id) return false;
    if (row.document_type !== candidate.document_type) return false;
    const a = row.accounting_entity_id;
    const b = candidate.accounting_entity_id;
    if (a != null && b != null && a !== b) return false;
    return true;
  });
}

/** Mensaje de la confirmación al activar una serie de notas. */
export function noteSeriesActivationMessage(
  candidatePrefix: string | null | undefined,
  conflicts: readonly NoteSeriesRow[],
): string {
  const others = conflicts.map((c) => c.prefix || 'sin prefijo').join(', ');
  const label = requirementsFor(
    conflicts[0].document_type as FiscalDocumentType,
  ).label;
  return `Al activar ${candidatePrefix || 'esta serie'} se desactivará ${others} (${label}). Solo puede haber una serie de notas activa.`;
}

/**
 * ¿La fila es la que toma el generador? Solo cuenta `source = 'resolution'`.
 * Si la fila trae `accounting_entity_id`, debe ser la de la respuesta.
 */
export function isResolutionInUse(
  row: { id: number; accounting_entity_id?: number | null },
  inUse: ResolutionsInUseResponse | null | undefined,
): boolean {
  if (!inUse) return false;
  if (
    row.accounting_entity_id != null &&
    row.accounting_entity_id !== inUse.accounting_entity_id
  ) {
    return false;
  }
  return inUse.items.some(
    (item) => item.source === 'resolution' && item.resolution_id === row.id,
  );
}

/** `deactivated_resolution_ids` de una respuesta de create/update (en `data` o en la raíz). */
export function extractDeactivatedResolutionIds(response: unknown): number[] {
  const r = response as any;
  const ids = r?.data?.deactivated_resolution_ids ?? r?.deactivated_resolution_ids;
  return Array.isArray(ids) ? ids : [];
}

export function deactivatedResolutionsToast(count: number): string {
  return count === 1
    ? 'Se desactivó 1 serie de notas que estaba activa.'
    : `Se desactivaron ${count} series de notas que estaban activas.`;
}
