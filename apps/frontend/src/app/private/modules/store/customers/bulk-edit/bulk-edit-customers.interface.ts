/**
 * Contrato de la edición masiva de clientes — espejo del backend.
 *
 * Fuente de verdad:
 * `apps/backend/src/domains/store/customers/dto/bulk-edit-customers.dto.ts`
 *
 * El `ValidationPipe` global corre con `whitelist: true` y
 * `forbidNonWhitelisted: true`, así que `BulkEditableCustomerChanges` es un
 * contrato CERRADO: cualquier propiedad que no exista en el DTO del backend
 * devuelve 400. No añadir campos aquí sin añadirlos primero allí.
 */

/** Tope duro de clientes por lote. Espejo de `MAX_BULK_EDIT_CUSTOMER_IDS`. */
export const MAX_BULK_EDIT_CUSTOMER_IDS = 100;

/** Espejo de `BulkCustomerItemStatus`. */
export type BulkCustomerItemStatus = 'ok' | 'warning' | 'error';

/** Espejo de `BulkCustomerTagActionMode`. */
export type BulkCustomerTagMode = 'add' | 'remove';

/** Acción sobre etiquetas CRM del lote. */
export interface BulkCustomerTagAction {
  mode: BulkCustomerTagMode;
  ids: number[];
}

/**
 * Subconjunto de `UpdateCustomerDto` habilitado en masa.
 *
 * Tres estados por campo: ausente = no se toca; `null` donde el backend lo
 * admite = se limpia; valor = se escribe. `price_tier_id` es el caso más claro:
 * `null` deja al cliente «Sin tarifa».
 *
 * EXCLUIDOS (documentados en el DTO del backend): `email` y el documento
 * (únicos por organización), `state` (no está en el DTO individual y gobierna el
 * login del portal), direcciones (tabla aparte, dato fiscal por cliente) y
 * cupo/días de crédito (no existen en el modelo).
 */
export interface BulkEditableCustomerChanges {
  first_name?: string | null;
  last_name?: string | null;
  legal_name?: string | null;
  phone?: string | null;
  person_type?: 'NATURAL' | 'JURIDICA' | null;
  tax_regime?: string | null;
  is_withholding_agent?: boolean;
  ciiu_code?: string | null;
  fiscal_responsibilities?: string[];
  /** `null` = limpiar la tarifa; ausente = no tocar. */
  price_tier_id?: number | null;
  tag_action?: BulkCustomerTagAction;
}

/** Cuerpo de `POST /store/customers/bulk-edit` y de su `/preview`. */
export interface BulkEditCustomersRequest {
  ids: number[];
  changes: BulkEditableCustomerChanges;
}

/** Espejo de `BulkCustomerFieldDiffDto`. */
export interface BulkCustomerFieldDiff {
  field: string;
  current: unknown;
  next: unknown;
}

/** Espejo de `BulkCustomerPreviewItemDto`. */
export interface BulkCustomerPreviewItem {
  id: number;
  name: string;
  document_number: string | null;
  status: BulkCustomerItemStatus;
  changes: BulkCustomerFieldDiff[];
  code?: string;
  message?: string;
}

/** Espejo de `BulkCustomerPreviewResultDto`. */
export interface BulkCustomerPreviewResult {
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  /** Clientes con una tarifa distinta que la asignación va a sobrescribir. */
  tier_overwrite_count: number;
  items: BulkCustomerPreviewItem[];
}

/** Espejo de `BulkCustomerResultItemDto` — tras aplicar no hay `warning`. */
export interface BulkCustomerResultItem {
  id: number;
  name: string;
  /** `skipped`: ya tenía esos valores, no se escribió nada. */
  status: 'ok' | 'skipped' | 'error';
  code?: string;
  message?: string;
}

/** Espejo de `BulkCustomerResultDto`. */
export interface BulkCustomerResult {
  total: number;
  successful: number;
  skipped: number;
  failed: number;
  results: BulkCustomerResultItem[];
}

/** Fila del panel: espejo de `BulkCustomerListRowDto`. */
export interface BulkCustomerRow {
  id: number;
  first_name: string;
  last_name: string;
  legal_name: string | null;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  person_type: string | null;
  state: string;
  price_tier_id: number | null;
  price_tier_name: string | null;
  city: string | null;
  state_province: string | null;
  created_at: string | Date | null;
}

/**
 * Filtros del panel. Todos opcionales y combinables con AND.
 *
 * `tag_ids` y `segment_ids` son arreglos aunque la UI elija uno solo: el
 * backend ya acepta varios (OR dentro de cada uno) y así el panel puede crecer
 * a multi-selección sin cambiar el contrato.
 */
export interface BulkCustomerFilters {
  search?: string;
  state?: 'active' | 'inactive' | '';
  tag_ids?: number[];
  segment_ids?: number[];
  price_tier_id?: number | null;
  without_price_tier?: boolean;
  city?: string;
  state_province?: string;
  created_from?: string;
  created_to?: string;
}

export const EMPTY_BULK_CUSTOMER_FILTERS: BulkCustomerFilters = {
  search: '',
  state: '',
  tag_ids: [],
  segment_ids: [],
  price_tier_id: null,
  without_price_tier: false,
  city: '',
  state_province: '',
  created_from: '',
  created_to: '',
};

/** Página de resultados con su total, para `app-pagination`. */
export interface BulkCustomerPage {
  data: BulkCustomerRow[];
  total: number;
}

/** Respuesta de `GET /store/customers/bulk-edit/ids`. */
export interface BulkCustomerIdsResult {
  ids: number[];
  total: number;
  /** `true` cuando el filtro supera el tope y la selección quedó recortada. */
  capped: boolean;
}

/** Tope del endpoint de ids (`MAX_BULK_CUSTOMER_FILTER_IDS` en el backend). */
export const MAX_BULK_CUSTOMER_FILTER_IDS = 1000;

/** Fase del troceado, para que la barra del modal sepa qué mide. */
export type BulkCustomerProgressPhase = 'idle' | 'preview' | 'apply';

export interface BulkCustomerProgress {
  phase: BulkCustomerProgressPhase;
  totalBatches: number;
  doneBatches: number;
  totalIds: number;
  doneIds: number;
}
