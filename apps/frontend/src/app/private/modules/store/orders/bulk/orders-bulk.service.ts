/**
 * Servicio HTTP del módulo de operaciones masivas de órdenes (QUI-599).
 *
 * ## Por qué vive aquí y no en `services/store-orders.service.ts`
 *
 * Todo lo que este servicio expone es exclusivo del flujo de operaciones
 * masivas (troceado en lotes, progreso, agregación de resultados
 * parciales, hidratación para imprimir). Mantenerlo en el módulo evita engordar el
 * servicio compartido de órdenes, que ya lo consumen el listado, el POS,
 * el detalle y el flujo individual.
 *
 * ## El troceado es responsabilidad del cliente, por contrato
 *
 * `BulkTransitionOrdersDto` / `BulkAssignRouteDto` / `BulkPrintOrdersDto`
 * declaran `@ArrayMaxSize(100)`, así que un lote de 101 ids devuelve 400
 * del `ValidationPipe` global. El backend NO trocea: expone un tope y lo
 * hace cumplir. Por tanto el cliente:
 *
 *  1. Parte la selección en lotes de `MAX_BULK_ORDERS_IDS`.
 *  2. Los envía **en serie** (`concatMap`, no `mergeMap`): cada lote son N
 *     transacciones fila por fila en el backend, y paralelizarlos
 *     multiplicaría la presión sobre el pool de conexiones sin ganancia
 *     perceptible.
 *  3. **No aborta la cadena cuando un lote falla.** El `catchError` está
 *     DENTRO del `concatMap`, así que degrada ese lote a "todos sus ids
 *     fallaron" y continúa con el siguiente. Un 500 en el lote 2 de 5 no
 *     puede dejar al operador sin saber qué pasó con los lotes 3, 4 y 5.
 *  4. Agrega los resultados de TODOS los lotes en un único informe.
 *
 * El progreso se publica como señal (`progress`) para que la barra de la
 * UI sea reactiva sin que ningún componente tenga que suscribirse a nada.
 *
 * ## Impresión masiva
 *
 * `POST /store/orders/bulk/print` devuelve DATOS en el envoltorio estándar
 * (`{ success, data }`), no un PDF: las órdenes hidratadas más el formato y
 * las copias canónicos de la DB. El documento lo dibuja
 * `PosTicketService.printTicketsBatch` en el frontend, orquestado por
 * `OrdersBulkPrintService` — el mismo renderer que el tiquete post-venta del
 * POS y la previsualización de Ajustes → Recibos, así que la paridad de
 * formato queda garantizada por construcción.
 *
 * Este servicio solo trae los datos (`fetchPrintableOrdersInBatches`); no sabe
 * nada de papel ni de iframes.
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, concatMap, from, of, toArray } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

import { environment } from '../../../../../../environments/environment';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  EMPTY_BULK_ORDERS_PREVIEW,
  IDLE_BULK_ORDERS_PROGRESS,
  MAX_BULK_ORDERS_IDS,
  type BulkAssignRouteRequest,
  type BulkOrderResultItem,
  type BulkOrdersPreviewResult,
  type BulkOrdersProgress,
  type BulkOrdersProgressPhase,
  type BulkOrdersResult,
  type BulkPrintOrdersRequest,
  type BulkPrintPayload,
  type BulkTransitionOrdersRequest,
} from './orders-bulk.interface';

/** Envoltorio estándar de `ResponseService` del backend. */
interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: unknown;
}

@Injectable({ providedIn: 'root' })
export class OrdersBulkService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  private readonly progressState = signal<BulkOrdersProgress>(
    IDLE_BULK_ORDERS_PROGRESS,
  );

  /** Progreso del troceado en curso. Señal de solo lectura para la barra. */
  readonly progress = this.progressState.asReadonly();

  /** Vuelve el progreso a cero (al cerrar la vista, p. ej.). */
  resetProgress(): void {
    this.progressState.set(IDLE_BULK_ORDERS_PROGRESS);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Preview (dry-run, troceado)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Dry-run de la transición. Se trocea igual que la escritura porque comparte
   * el mismo DTO y por tanto el mismo `@ArrayMaxSize(100)`.
   *
   * A diferencia de la escritura, un lote caído aquí **sí** degrada a `error`
   * en todas sus filas pero NO detiene la cadena: el operador debe poder ver el
   * veredicto de los lotes que sí respondieron. Si se ocultara el lote caído,
   * la cabecera del modal prometería menos órdenes de las que se van a tocar.
   */
  previewTransitionInBatches(
    request: BulkTransitionOrdersRequest,
  ): Observable<BulkOrdersPreviewResult> {
    const batches = this.startPhase('preview', request.ids);
    if (batches.length === 0) {
      return of(EMPTY_BULK_ORDERS_PREVIEW);
    }

    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post<ApiEnvelope<BulkOrdersPreviewResult>>(
            `${this.apiUrl}/store/orders/bulk/transition/preview`,
            { ...request, ids: batch },
          )
          .pipe(
            map((res) => res.data),
            catchError((err: unknown) =>
              of(this.previewFallback(batch, err, request.targetState)),
            ),
            tap(() => this.advance(batch.length)),
          ),
      ),
      toArray(),
      map((parts) => mergePreviews(parts)),
    );
  }

  /** Dry-run de la asignación a ruta. Mismo troceado y misma tolerancia. */
  previewAssignRouteInBatches(
    request: BulkAssignRouteRequest,
  ): Observable<BulkOrdersPreviewResult> {
    const batches = this.startPhase('preview', request.ids);
    if (batches.length === 0) {
      return of(EMPTY_BULK_ORDERS_PREVIEW);
    }

    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post<ApiEnvelope<BulkOrdersPreviewResult>>(
            `${this.apiUrl}/store/orders/bulk/assign-route/preview`,
            { ...request, ids: batch },
          )
          .pipe(
            map((res) => res.data),
            catchError((err: unknown) =>
              of(this.previewFallback(batch, err, 'assign-route')),
            ),
            tap(() => this.advance(batch.length)),
          ),
      ),
      toArray(),
      map((parts) => mergePreviews(parts)),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Transition (troceada)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Transiciona N órdenes al mismo estado destino. Un lote que falla NO
   * detiene los siguientes y sus ids aparecen como fallidos en el informe
   * final, nunca desaparecen.
   */
  transitionInBatches(
    request: BulkTransitionOrdersRequest,
  ): Observable<BulkOrdersResult> {
    const batches = this.startPhase('transition', request.ids);
    if (batches.length === 0) {
      return of({ total: 0, successful: 0, failed: 0, results: [] });
    }

    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post<ApiEnvelope<BulkOrdersResult>>(
            `${this.apiUrl}/store/orders/bulk/transition`,
            { ...request, ids: batch },
          )
          .pipe(
            map((res) => res.data),
            catchError((err: unknown) =>
              of(this.fallback(batch, err, request.targetState)),
            ),
            tap(() => this.advance(batch.length)),
          ),
      ),
      toArray(),
      map((parts) => mergeResults(parts)),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Assign route (troceada)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Crea remisiones desde cada orden y las asigna como stops a la planilla
   * `route_id`. Un lote que falla no detiene los siguientes.
   */
  assignRouteInBatches(
    request: BulkAssignRouteRequest,
  ): Observable<BulkOrdersResult> {
    const batches = this.startPhase('assign-route', request.ids);
    if (batches.length === 0) {
      return of({ total: 0, successful: 0, failed: 0, results: [] });
    }

    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post<ApiEnvelope<BulkOrdersResult>>(
            `${this.apiUrl}/store/orders/bulk/assign-route`,
            { ...request, ids: batch },
          )
          .pipe(
            map((res) => res.data),
            catchError((err: unknown) =>
              of(this.fallback(batch, err, 'assign-route')),
            ),
            tap(() => this.advance(batch.length)),
          ),
      ),
      toArray(),
      map((parts) => mergeResults(parts)),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Print (troceada, datos JSON)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Trae las órdenes imprimibles de la selección, hidratadas con lo que lee el
   * tiquete POS, más el formato y las copias canónicos de la DB.
   *
   * NO imprime: eso lo hace `OrdersBulkPrintService` pasando estos datos por
   * `OrderTicketService.toTicketData` y `PosTicketService.printTicketsBatch`.
   * La separación mantiene este servicio como capa HTTP pura.
   *
   * La UI bloquea la selección en `MAX_BULK_ORDERS_IDS`, que es el mismo tope
   * que trocea `startPhase`, así que en la práctica siempre hay UN lote. El
   * troceado se mantiene como red de seguridad por si el gate de la UI y el
   * `@ArrayMaxSize` del DTO llegaran a divergir; los lotes se funden en un
   * único payload, de modo que N lotes siguen produciendo UN solo documento y
   * UN solo diálogo de impresión.
   *
   * El backend es tolerante por orden: omite las canceladas / reembolsadas /
   * inexistentes y devuelve el resto en `orders`, con el motivo de cada omisión
   * en `skipped`. Por eso el operador puede saber que pidió 20 y salieron 17.
   *
   * Un lote caído NO tumba la cadena: el `catchError` está DENTRO del
   * `concatMap`, así que ese lote degrada a `failedIds` + `failureMessage` con
   * el mensaje REAL del backend (ahora que el cuerpo de error es JSON,
   * `extractApiErrorMessage` lo recupera directo; antes había que leer un Blob
   * como texto y parsearlo a mano) y los lotes siguientes se piden igual.
   *
   * Devuelve un payload vacío si la selección estaba vacía.
   */
  fetchPrintableOrdersInBatches(
    request: BulkPrintOrdersRequest,
  ): Observable<BulkPrintPayload> {
    const batches = this.startPhase('print', request.ids);
    if (batches.length === 0) {
      return of(EMPTY_PRINT_PAYLOAD);
    }

    // El troceado se aplica igual con un lote o con varios: un solo camino de
    // código evita que el caso de 1 lote (el 99% real) diverja del de N.
    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post<ApiEnvelope<BulkPrintPayload>>(
            `${this.apiUrl}/store/orders/bulk/print`,
            { ...request, ids: batch },
          )
          .pipe(
            map((res) => this.toPrintPayload(res?.data, batch)),
            catchError((error: unknown) =>
              of(this.failedPrintPayload(error, batch)),
            ),
            tap(() => this.advance(batch.length)),
          ),
      ),
      toArray(),
      map((parts) => mergePrintPayloads(parts)),
    );
  }

  /**
   * Normaliza el `data` del backend a un payload con arreglos siempre
   * presentes. `printable` se toma del backend y no de `orders.length` para no
   * reinterpretar en el cliente un conteo que el backend ya declaró; si viniera
   * ausente se deriva del arreglo, que es el único otro dato disponible.
   */
  private toPrintPayload(
    data: BulkPrintPayload | undefined,
    batch: readonly number[],
  ): BulkPrintPayload {
    const orders = data?.orders ?? [];
    return {
      total: data?.total ?? batch.length,
      printable: data?.printable ?? orders.length,
      orders,
      skipped: data?.skipped ?? [],
      pos_ticket_format: data?.pos_ticket_format,
      pos_ticket_copies: data?.pos_ticket_copies,
      failedIds: [],
    };
  }

  /**
   * Lote caído → sus ids como fallidos con el mensaje real, nunca perdidos.
   *
   * Con el cuerpo de error en JSON, `extractApiErrorMessage` recupera el
   * `message` del backend directamente. Ya no hay que leer un Blob como texto
   * ni devolver un Observable asíncrono desde el `catchError`.
   */
  private failedPrintPayload(
    error: unknown,
    batch: readonly number[],
  ): BulkPrintPayload {
    // Arreglos literales y no un spread de `EMPTY_PRINT_PAYLOAD`: esa constante
    // es compartida y copiar sus referencias invitaría a una mutación cruzada.
    return {
      total: batch.length,
      printable: 0,
      orders: [],
      skipped: [],
      failureMessage: extractApiErrorMessage(error),
      failedIds: [...batch],
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internos
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Trocea la selección al tope del backend y arranca la señal de progreso.
   *
   * Como la UI corta la selección en el mismo `MAX_BULK_ORDERS_IDS`, en la
   * práctica siempre sale un único lote. El troceado se mantiene como red de
   * seguridad por si el gate de la UI y el `@ArrayMaxSize` del DTO llegaran a
   * divergir.
   */
  private startPhase(
    phase: Exclude<BulkOrdersProgressPhase, 'idle'>,
    ids: readonly number[],
  ): number[][] {
    const batches = chunk([...ids], MAX_BULK_ORDERS_IDS);
    this.progressState.set({
      phase,
      totalBatches: batches.length,
      doneBatches: 0,
      totalIds: ids.length,
      doneIds: 0,
    });
    return batches;
  }

  private advance(processedIds: number): void {
    this.progressState.update((prev) => ({
      ...prev,
      doneBatches: prev.doneBatches + 1,
      doneIds: prev.doneIds + processedIds,
    }));
  }

  /**
   * Lote caído → todos sus ids como fallidos, nunca perdidos. Mismo
   * contrato que el fallback de productos (QUI-567): el operador siempre
   * ve qué ids no se procesaron y por qué.
   */
  private fallback(
    batch: readonly number[],
    err: unknown,
    context: string,
  ): BulkOrdersResult {
    const { errorCode, userMessage } = parseApiError(err);
    const results: BulkOrderResultItem[] = batch.map((id) => ({
      id,
      status: 'error',
      code: errorCode ?? `ORD_BULK_${context.toUpperCase()}_FAIL`,
      message: userMessage,
    }));
    return {
      total: batch.length,
      successful: 0,
      failed: batch.length,
      results,
    };
  }

  /**
   * Lote de preview caído → sus ids como `error`, con el motivo real. No se
   * inventa un veredicto optimista: si no sabemos si la orden se puede tocar,
   * decirlo es lo único honesto que puede hacer una pre-confirmación.
   */
  private previewFallback(
    batch: readonly number[],
    err: unknown,
    context: string,
  ): BulkOrdersPreviewResult {
    const { errorCode, userMessage } = parseApiError(err);
    return {
      total: batch.length,
      ok: 0,
      warnings: 0,
      skipped: 0,
      errors: batch.length,
      items: batch.map((id) => ({
        id,
        order_number: `#${id}`,
        current_state: 'desconocido',
        status: 'error' as const,
        code: errorCode ?? `ORD_BULK_PREVIEW_${context.toUpperCase()}_FAIL`,
        message: userMessage,
      })),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros
// ─────────────────────────────────────────────────────────────────────────────

/** Parte un arreglo en lotes de `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return items.length > 0 ? [items] : [];
  }
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Suma los dry-runs de todos los lotes en uno solo. Los contadores se suman en
 * vez de recalcularse desde `items` para que un lote que el backend contó de
 * otra forma no quede silenciosamente reinterpretado por el cliente.
 */
export function mergePreviews(
  parts: readonly BulkOrdersPreviewResult[],
): BulkOrdersPreviewResult {
  return parts.reduce<BulkOrdersPreviewResult>(
    (acc, part) => ({
      total: acc.total + (part?.total ?? 0),
      ok: acc.ok + (part?.ok ?? 0),
      warnings: acc.warnings + (part?.warnings ?? 0),
      skipped: acc.skipped + (part?.skipped ?? 0),
      errors: acc.errors + (part?.errors ?? 0),
      items: [...acc.items, ...(part?.items ?? [])],
    }),
    { total: 0, ok: 0, warnings: 0, skipped: 0, errors: 0, items: [] },
  );
}

/** Suma los informes de todos los lotes en uno solo. */
export function mergeResults(
  parts: readonly BulkOrdersResult[],
): BulkOrdersResult {
  return parts.reduce<BulkOrdersResult>(
    (acc, part) => ({
      total: acc.total + (part?.total ?? 0),
      successful: acc.successful + (part?.successful ?? 0),
      failed: acc.failed + (part?.failed ?? 0),
      results: [...acc.results, ...(part?.results ?? [])],
    }),
    { total: 0, successful: 0, failed: 0, results: [] },
  );
}

/** Payload neutro: selección vacía. */
export const EMPTY_PRINT_PAYLOAD: BulkPrintPayload = {
  total: 0,
  printable: 0,
  orders: [],
  skipped: [],
  failedIds: [],
};

/**
 * Funde los payloads de todos los lotes en uno, para que N lotes sigan
 * produciendo UN solo documento y UN solo diálogo de impresión.
 *
 * Mismo `reduce` que la versión que fundía outcomes de PDF: suma contadores y
 * concatena `orders` / `skipped` / `failedIds`. Ya no hay blobs que concatenar.
 *
 * `failureMessage` se queda con el PRIMER fallo, no con el último: si tres lotes
 * fallan por la misma causa, repetir el mensaje no aporta, y el primero es el
 * que el operador puede correlacionar con lo que vio.
 *
 * `pos_ticket_format` / `pos_ticket_copies` se quedan con el PRIMER valor
 * presente: todos los lotes son de la misma tienda (`orders` es un modelo
 * store-scoped, un id ajeno cae en `skipped:not_found`), así que el valor es el
 * mismo en todos; conservar el primero evita que un lote caído —que no trae
 * ninguno de los dos— borre el que sí llegó.
 */
export function mergePrintPayloads(
  parts: readonly BulkPrintPayload[],
): BulkPrintPayload {
  return parts.reduce<BulkPrintPayload>(
    (acc, part) => ({
      total: acc.total + (part?.total ?? 0),
      printable: acc.printable + (part?.printable ?? 0),
      orders: [...acc.orders, ...(part?.orders ?? [])],
      skipped: [...acc.skipped, ...(part?.skipped ?? [])],
      pos_ticket_format: acc.pos_ticket_format ?? part?.pos_ticket_format,
      pos_ticket_copies: acc.pos_ticket_copies ?? part?.pos_ticket_copies,
      failureMessage: acc.failureMessage ?? part?.failureMessage,
      failedIds: [...acc.failedIds, ...(part?.failedIds ?? [])],
    }),
    { total: 0, printable: 0, orders: [], skipped: [], failedIds: [] },
  );
}