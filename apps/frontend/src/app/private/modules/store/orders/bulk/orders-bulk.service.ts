/**
 * Servicio HTTP del módulo de operaciones masivas de órdenes (QUI-599).
 *
 * ## Por qué vive aquí y no en `services/store-orders.service.ts`
 *
 * Todo lo que este servicio expone es exclusivo del flujo de operaciones
 * masivas (troceado en lotes, progreso, agregación de resultados
 * parciales, descarga de PDF). Mantenerlo en el módulo evita engordar el
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
 * `POST /store/orders/bulk/print` devuelve un Blob (`application/pdf`), no
 * un envoltorio `ResponseService`. El troceado aplica igual: el backend
 * genera un PDF por lote y el cliente los concatena descargándolos y
 * abriendo cada uno. La alternativa de un solo PDF en el backend para 100
 * órdenes elegida en el plan (mejor UX: un solo diálogo de impresión) se
 * presiona en lotes aquí solo cuando la selección excede el tope; el
 * operador verá N diálogos en ese caso, que es el comportamiento seguro
 * (no bloquear el navegador generando un PDF gigante).
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, concatMap, from, of, toArray } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

import { environment } from '../../../../../../environments/environment';
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
  // Print (troceada, Blob)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Genera un PDF multi-página con todas las órdenes seleccionadas. El
   * formato de papel lo resuelve el backend desde `store_settings.receipts`.
   *
   * Cuando la selección excede `MAX_BULK_ORDERS_IDS`, el cliente trocea y
   * descarga N blobs. El operador verá N diálogos de impresión en ese caso
   * (raro para ≈100 órdenes/día). Para selecciones que caben en un lote, un
   * solo blob → un solo diálogo, que es la UX elegida en el plan.
   *
   * Devuelve `null` si la selección estaba vacía.
   */
  printInBatches(request: BulkPrintOrdersRequest): Observable<Blob | null> {
    const batches = this.startPhase('print', request.ids);
    if (batches.length === 0) {
      return of(null);
    }

    // Un solo lote → un solo Blob, un solo diálogo de impresión.
    if (batches.length === 1) {
      return this.http
        .post(`${this.apiUrl}/store/orders/bulk/print`, request, {
          responseType: 'blob',
        })
        .pipe(
          tap(() => this.advance(batches[0].length)),
          catchError(() => of(null)),
        );
    }

    // Varios lotes → concatenar los blobs en orden. Cada lote es un PDF
    // válido; el navegador abre cada uno por separado al imprimir.
    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post(
            `${this.apiUrl}/store/orders/bulk/print`,
            { ...request, ids: batch },
            { responseType: 'blob' },
          )
          .pipe(
            catchError(() => of(null as Blob | null)),
            tap(() => this.advance(batch.length)),
          ),
      ),
      toArray(),
      map((blobs) => {
        const valid = blobs.filter((b): b is Blob => b !== null);
        return valid.length > 0 ? new Blob(valid, { type: 'application/pdf' }) : null;
      }),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internos
  // ───────────────────────────────────────────────────────────────────────────

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