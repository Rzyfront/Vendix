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

import {
  HttpClient,
  HttpErrorResponse,
  HttpResponse,
} from '@angular/common/http';
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
  type BulkPrintOutcome,
  type BulkPrintSkippedOrder,
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
   * La UI bloquea la selección en `MAX_BULK_ORDERS_IDS`, que es el mismo tope
   * que trocea `startPhase`, así que en la práctica siempre hay UN lote: un
   * solo blob → un solo diálogo de impresión, que es la UX elegida en el plan.
   * El troceado se mantiene como red de seguridad por si algún día el tope de
   * la UI y el del request divergen.
   *
   * El backend es tolerante por orden: omite las canceladas / reembolsadas /
   * inexistentes y devuelve el PDF con el resto, reportando lo omitido en las
   * cabeceras `X-Printed-Count` / `X-Skipped-Count` / `X-Skipped-Orders`. Por
   * eso este método devuelve un {@link BulkPrintOutcome} y no un `Blob` pelado:
   * el operador necesita saber que pidió 20 y salieron 17.
   *
   * Tampoco traga ya los errores. Antes un `catchError(() => of(null))` los
   * silenciaba y la UI decía "Revisa los permisos y la configuración de
   * recibos" ante CUALQUIER fallo — incluido el 400 de
   * `pdfkit_1.default is not a constructor`, que no tenía nada que ver con
   * permisos ni con recibos y solo era visible en la pestaña de red. Ahora el
   * mensaje real del backend llega en `failureMessage`.
   *
   * Devuelve un outcome vacío si la selección estaba vacía.
   */
  printInBatches(request: BulkPrintOrdersRequest): Observable<BulkPrintOutcome> {
    const batches = this.startPhase('print', request.ids);
    if (batches.length === 0) {
      return of(EMPTY_PRINT_OUTCOME);
    }

    // El troceado se aplica igual con un lote o con varios: un solo camino de
    // código evita que el caso de 1 lote (el 99% real) diverja del de N.
    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post(
            `${this.apiUrl}/store/orders/bulk/print`,
            { ...request, ids: batch },
            { responseType: 'blob', observe: 'response' },
          )
          .pipe(
            map((response) => this.toPrintOutcome(response, batch)),
            catchError((error: unknown) =>
              this.toFailedPrintOutcome(error, batch),
            ),
            tap(() => this.advance(batch.length)),
          ),
      ),
      toArray(),
      map((parts) => mergePrintOutcomes(parts)),
    );
  }

  /** Traduce una respuesta 200 con PDF a un outcome, leyendo las cabeceras. */
  private toPrintOutcome(
    response: HttpResponse<Blob>,
    batch: readonly number[],
  ): BulkPrintOutcome {
    const skipped = this.parseSkippedHeader(
      response.headers.get('X-Skipped-Orders'),
    );
    // `X-Printed-Count` es la verdad del backend. El fallback a
    // `batch.length` solo cubre el caso de que un proxy filtre la cabecera:
    // preferible un conteo optimista a mostrar "0 impresas" con un PDF válido
    // en la mano.
    const printedHeader = Number(response.headers.get('X-Printed-Count'));
    const skippedHeader = Number(response.headers.get('X-Skipped-Count'));

    return {
      blob: response.body,
      printed: Number.isFinite(printedHeader) && printedHeader >= 0
        ? printedHeader
        : batch.length,
      skippedCount: Number.isFinite(skippedHeader) && skippedHeader >= 0
        ? skippedHeader
        : skipped.length,
      skipped,
      skippedTruncated: response.headers.get('X-Skipped-Truncated') === 'true',
      failedIds: [],
    };
  }

  /**
   * Traduce un error HTTP a un outcome fallido, extrayendo el mensaje real.
   *
   * Con `responseType: 'blob'`, el cuerpo de error TAMBIÉN llega como Blob, así
   * que `error.error.message` es `undefined` y el mensaje del backend queda
   * ilegible. Hay que leer el Blob como texto y parsear el JSON — este es el
   * paso que faltaba para que el 400 llegara a la UI.
   */
  private toFailedPrintOutcome(
    error: unknown,
    batch: readonly number[],
  ): Observable<BulkPrintOutcome> {
    const failed: BulkPrintOutcome = {
      ...EMPTY_PRINT_OUTCOME,
      failedIds: [...batch],
    };

    const body = (error as HttpErrorResponse | undefined)?.error;
    if (!(body instanceof Blob)) {
      return of({ ...failed, failureMessage: extractApiErrorMessage(error) });
    }

    return from(body.text()).pipe(
      map((text) => {
        try {
          const parsed = JSON.parse(text) as {
            message?: string;
            error_code?: string;
          };
          return { ...failed, failureMessage: parsed.message };
        } catch {
          return { ...failed, failureMessage: text || undefined };
        }
      }),
      catchError(() => of(failed)),
    );
  }

  /** Decodifica `X-Skipped-Orders` (JSON en `encodeURIComponent`). */
  private parseSkippedHeader(raw: string | null): BulkPrintSkippedOrder[] {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(raw));
      return Array.isArray(parsed) ? (parsed as BulkPrintSkippedOrder[]) : [];
    } catch {
      // Una cabecera ilegible no puede tumbar una impresión que sí funcionó.
      return [];
    }
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

/** Outcome neutro: selección vacía o lote sin PDF. */
export const EMPTY_PRINT_OUTCOME: BulkPrintOutcome = {
  blob: null,
  printed: 0,
  skippedCount: 0,
  skipped: [],
  skippedTruncated: false,
  failedIds: [],
};

/**
 * Funde los outcomes de todos los lotes.
 *
 * Los blobs se concatenan en un único `Blob` como hacía la versión anterior.
 * Solo entra en juego por encima de `MAX_BULK_ORDERS_IDS` órdenes, que es el
 * caso raro; el camino habitual es un lote → un blob → un diálogo.
 *
 * `failureMessage` se queda con el PRIMER fallo, no con el último: si tres
 * lotes fallan por la misma causa, repetir el mensaje no aporta, y el primero
 * es el que el operador puede correlacionar con lo que vio.
 */
export function mergePrintOutcomes(
  parts: readonly BulkPrintOutcome[],
): BulkPrintOutcome {
  const blobs = parts
    .map((p) => p?.blob)
    .filter((b): b is Blob => b instanceof Blob);

  return {
    blob:
      blobs.length > 0 ? new Blob(blobs, { type: 'application/pdf' }) : null,
    printed: parts.reduce((acc, p) => acc + (p?.printed ?? 0), 0),
    skippedCount: parts.reduce((acc, p) => acc + (p?.skippedCount ?? 0), 0),
    skipped: parts.flatMap((p) => p?.skipped ?? []),
    skippedTruncated: parts.some((p) => p?.skippedTruncated === true),
    failureMessage: parts.find((p) => p?.failureMessage)?.failureMessage,
    failedIds: parts.flatMap((p) => p?.failedIds ?? []),
  };
}