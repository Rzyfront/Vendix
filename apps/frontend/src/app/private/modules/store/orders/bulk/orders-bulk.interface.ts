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

import type { PrintFormat } from '../../../../../core/models/store-settings.interface';
import type { Order } from '../interfaces/order.interface';

/**
 * Tope duro de órdenes por lote, común a las tres operaciones masivas. Espejo
 * de `MAX_BULK_ORDERS_IDS` (`bulk-orders.dto.ts`), aplicado en backend por
 * `@ArrayMaxSize`.
 *
 * En el frontend NO es solo un gate de la acción: la selección misma se corta
 * aquí (`toggleRow` / `toggleAllVisible`). Dejar marcar 500 casillas para luego
 * negarse a operar es peor UX que impedir la 301 en el momento y decir por qué.
 *
 * Si este valor supera al del backend, la UI deja seleccionar más de lo que el
 * DTO acepta y el operador se come un 400 de validación. Se cambian juntos.
 */
export const MAX_BULK_ORDERS_IDS = 300;

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

/**
 * Cuerpo de `POST /store/orders/bulk/print`.
 *
 * `copies` está DEPRECADO en el backend y no tiene efecto: el endpoint dejó de
 * dibujar el documento, así que el número de copias lo aplica
 * `PosTicketService` en el frontend a partir de `pos_ticket_copies` que viene
 * en la respuesta. Se conserva declarado porque el DTO todavía lo acepta.
 */
export interface BulkPrintOrdersRequest {
  ids: number[];
  /** @deprecated Sin efecto. Las copias las resuelve el render del frontend. */
  copies?: number;
}

/**
 * Motivo por el que una orden quedó fuera de la impresión. Espeja
 * `BulkPrintSkipReason` del backend.
 *
 * `render_error` ya no lo emite el backend (dejó de dibujar): es el motivo que
 * el FRONTEND usaría si `PosTicketService` no pudiera dibujar una orden. Hoy
 * `printTicketsBatch` es todo-o-nada a propósito, así que un fallo de render se
 * reporta como lote caído (`failureMessage` + `failedIds`) y no como omisión
 * silenciosa de una orden que el operador sí seleccionó.
 */
export type BulkPrintSkipReason =
  | 'not_found'
  | 'non_printable_state'
  | 'render_error';

/** Una orden excluida de la impresión, con su motivo legible. */
export interface BulkPrintSkippedOrder {
  id: number;
  /** Ausente cuando el motivo es `not_found` (no hubo fila que leer). */
  order_number?: string;
  reason: BulkPrintSkipReason;
  message: string;
}

/**
 * Datos que devuelve `POST /store/orders/bulk/print`. Espejo de
 * `BulkPrintResultDto` del backend, más los dos campos que agrega el cliente al
 * fundir lotes (`failureMessage` / `failedIds`).
 *
 * El endpoint devuelve DATOS, no un documento: el render vive en
 * `PosTicketService`, el mismo servicio que dibuja el tiquete post-venta del POS
 * y la previsualización de Ajustes → Recibos. La paridad de formato queda
 * garantizada por construcción y no por convenio.
 *
 * Invariante del backend por lote: `printable + skipped.length === total` y
 * `printable === orders.length`.
 */
export interface BulkPrintPayload {
  /** Ids pedidos. */
  total: number;
  /** Órdenes que el frontend va a dibujar. Igual a `orders.length`. */
  printable: number;
  /**
   * Órdenes hidratadas con exactamente lo que lee el tiquete POS: líneas,
   * cliente, dirección de envío, pago exitoso (con la relación del método) y
   * factura DIAN aceptada.
   */
  orders: Order[];
  /**
   * Órdenes descartadas, COMPLETAS. Antes viajaban en la cabecera
   * `X-Skipped-Orders` truncada a 20 por el límite de 8 KB de nginx; ahora van
   * en el body, así que el flag `skippedTruncated` desapareció junto con
   * `skippedCount` — `skipped.length` ES el total y no puede discrepar de la
   * lista que se le muestra al operador.
   */
  skipped: BulkPrintSkippedOrder[];
  /**
   * Formato de papel canónico leído de la DB EN esta respuesta.
   *
   * No es redundante con lo que el frontend ya tiene: `StoreSettingsFacade`
   * sirve `receipts` desde el snapshot de `vendix_auth_state`, que solo se
   * rehidrata al re-loguear. Se pasa como `formatOverride` a
   * `printTicketsBatch`. Opcional en el tipo para tolerar un backend anterior:
   * `currentPrinterConfig` degrada a `thermal_80`.
   */
  pos_ticket_format?: PrintFormat;
  /**
   * Copias por tiquete, canónicas de la DB. Viaja por la misma razón que
   * `pos_ticket_format` y se pasa como `copiesOverride`: mitigar el formato y
   * no las copias dejaría el arreglo a medias.
   */
  pos_ticket_copies?: number;
  /**
   * Mensaje del PRIMER lote que falló por completo, si hubo alguno. Se separa de
   * `skipped` porque un lote caído no es "órdenes omitidas": es una petición que
   * no llegó a traer datos.
   */
  failureMessage?: string;
  /** Ids de los lotes que no devolvieron datos. */
  failedIds: number[];
}

/**
 * Resultado de la impresión masiva, ya renderizada.
 *
 * `rendered === 0` significa que NADA llegó al papel: o ningún lote trajo datos,
 * o el render falló. Es el discriminante del primer desenlace del informe al
 * operador (antes lo era `blob === null`, cuando el backend devolvía el PDF).
 */
export interface BulkPrintOutcome {
  /** Tiquetes efectivamente dibujados en el documento enviado a la impresora. */
  rendered: number;
  /** Hojas resultantes (`rendered × copias`), para confirmar el gasto de papel. */
  pages: number;
  /** Órdenes descartadas por el backend, completas. */
  skipped: BulkPrintSkippedOrder[];
  /** Mensaje real del primer fallo (fetch o render), si hubo alguno. */
  failureMessage?: string;
  /** Ids que no llegaron a dibujarse por un lote caído o un render fallido. */
  failedIds: number[];
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