/**
 * Contrato de operaciones masivas de órdenes (QUI-599) — espejo EXACTO del
 * backend.
 *
 * Fuente de verdad:
 * `apps/backend/src/domains/store/orders/dto/bulk-orders.dto.ts`
 *
 * El `ValidationPipe` global corre con `whitelist: true` y
 * `forbidNonWhitelisted: true`, así que este contrato es CERRADO: cualquier
 * propiedad que no exista en el DTO devuelve 400.
 */

/**
 * Tope duro de órdenes por lote. Espejo de `MAX_BULK_ORDERS_IDS`
 * (`bulk-orders.dto.ts:24`), aplicado en backend por `@ArrayMaxSize`.
 * El frontend lo reutiliza para trocear la selección en lotes y no
 * mandar más ids de los que el backend acepta.
 *
 * 100 órdenes por lote cubre el caso de uso reportado (≈100 órdenes/día).
 */
export const MAX_BULK_ORDERS_IDS = 100;

/**
 * Estados destino permitidos en el carril masivo. Espejo de
 * `BulkOrderTransitionTarget` del backend. El servicio delega en
 * `OrderFlowService.forceOrderState`, que enruta cada destino al método
 * canónico con efectos completos (cancelar pagos, liberar reservas,
 * emitir `order.shipped` / `order.status_changed`, commit de inventario).
 */
export type BulkOrderTransitionTarget =
  | 'finished'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

/**
 * Estado de una fila dentro de un resultado masivo. No hay `warning` en la
 * aplicación real: una orden o se transiciona / imprime / asigna, o no.
 * Espejo de `BulkOrderItemStatus` del backend.
 */
export type BulkOrderItemStatus = 'ok' | 'error';

/** Espejo de `BulkOrderResultItemDto`. */
export interface BulkOrderResultItem {
  id: number;
  status: BulkOrderItemStatus;
  /** Código de error estable cuando `status === 'error'`. */
  code?: string;
  /** Mensaje humano-legible del fallo o confirmación. */
  message?: string;
}

/** Espejo de `BulkOrdersResultDto`. */
export interface BulkOrdersResult {
  total: number;
  successful: number;
  failed: number;
  results: BulkOrderResultItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-confirmación (dry-run)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Veredicto por orden en el dry-run. Espejo de `BulkOrderPreviewStatus`.
 *
 * A diferencia del resultado real aquí hay CUATRO estados, porque el operador
 * necesita distinguir por qué una orden no se moverá:
 * `ok` se aplica · `warning` se aplica forzando la máquina de estados ·
 * `skipped` no se toca y no es fallo (ya está en destino / ya remitida) ·
 * `error` no se puede.
 */
export type BulkOrderPreviewStatus = 'ok' | 'warning' | 'skipped' | 'error';

/** Espejo de `BulkOrderPreviewItemDto`. */
export interface BulkOrderPreviewItem {
  id: number;
  order_number: string;
  current_state: string;
  status: BulkOrderPreviewStatus;
  code?: string;
  message?: string;
}

/**
 * Espejo de `BulkOrdersPreviewResultDto`. `ok + warnings` es lo que realmente
 * se va a escribir, y es lo que gobierna si el botón de confirmar se habilita.
 */
export interface BulkOrdersPreviewResult {
  total: number;
  ok: number;
  warnings: number;
  skipped: number;
  errors: number;
  items: BulkOrderPreviewItem[];
}

/** Acumulador vacío, para arrancar el merge de lotes sin ramas nulas. */
export const EMPTY_BULK_ORDERS_PREVIEW: BulkOrdersPreviewResult = {
  total: 0,
  ok: 0,
  warnings: 0,
  skipped: 0,
  errors: 0,
  items: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Cuerpos de las peticiones
// ─────────────────────────────────────────────────────────────────────────────

/** Cuerpo de `POST /store/orders/bulk/transition`. */
export interface BulkTransitionOrdersRequest {
  ids: number[];
  targetState: BulkOrderTransitionTarget;
  reason?: string;
}

/** Cuerpo de `POST /store/orders/bulk/assign-route`. */
export interface BulkAssignRouteRequest {
  ids: number[];
  route_id: number;
}

/** Cuerpo de `POST /store/orders/bulk/print`. */
export interface BulkPrintOrdersRequest {
  ids: number[];
  copies?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Progreso del troceado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fase del troceado, para que la UI sepa qué está midiendo la barra.
 *
 * `transition` / `assign-route` / `print` comparten la MISMA señal de
 * progreso a propósito: las acciones son mutuamente excluyentes (el
 * operador solo dispara una a la vez desde la barra de acciones), así
 * que duplicar la señal solo añadiría estado que sincronizar.
 */
export type BulkOrdersProgressPhase =
  | 'idle'
  | 'preview'
  | 'transition'
  | 'assign-route'
  | 'print';

export interface BulkOrdersProgress {
  phase: BulkOrdersProgressPhase;
  totalBatches: number;
  doneBatches: number;
  totalIds: number;
  doneIds: number;
}

export const IDLE_BULK_ORDERS_PROGRESS: BulkOrdersProgress = {
  phase: 'idle',
  totalBatches: 0,
  doneBatches: 0,
  totalIds: 0,
  doneIds: 0,
};