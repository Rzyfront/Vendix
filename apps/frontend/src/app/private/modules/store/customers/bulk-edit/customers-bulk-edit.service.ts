/**
 * Servicio HTTP de la edición masiva de clientes.
 *
 * ## Por qué vive aquí y no en `services/customers.service.ts`
 *
 * Todo lo que expone es exclusivo del flujo masivo (listado filtrado del panel,
 * ids por filtro, troceado, progreso). El servicio compartido de clientes ya lo
 * consumen el listado, el POS y el checkout; meterle esto lo engordaría sin que
 * ninguno de esos flujos lo use.
 *
 * ## El troceado es del cliente, por contrato
 *
 * `BulkEditCustomersDto` declara `@ArrayMaxSize(100)`, así que 101 ids devuelven
 * 400 del `ValidationPipe` global. El backend NO trocea: expone el tope y lo
 * hace cumplir. Por tanto aquí:
 *
 *  1. La selección se parte en lotes de `MAX_BULK_EDIT_CUSTOMER_IDS`.
 *  2. Los lotes se envían EN SERIE (`concatMap`, no `mergeMap`): cada uno son N
 *     transacciones fila por fila y paralelizarlos solo presionaría el pool de
 *     conexiones.
 *  3. Un lote que falla NO aborta los siguientes: el `catchError` va DENTRO del
 *     `concatMap`, así que ese lote degrada a «todos sus ids fallaron» y la
 *     cadena continúa. El operador nunca se queda sin saber qué pasó con el
 *     resto.
 */

import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, concatMap, from, map, of, toArray } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import { environment } from '../../../../../../environments/environment';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  BulkCustomerFilters,
  BulkCustomerIdsResult,
  BulkCustomerPage,
  BulkCustomerPreviewItem,
  BulkCustomerPreviewResult,
  BulkCustomerProgress,
  BulkCustomerResult,
  BulkCustomerResultItem,
  BulkCustomerRow,
  BulkEditableCustomerChanges,
  MAX_BULK_EDIT_CUSTOMER_IDS,
} from './bulk-edit-customers.interface';

/** Envoltorio estándar de `ResponseService` del backend. */
interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: { total?: number } & Record<string, unknown>;
}

const IDLE_PROGRESS: BulkCustomerProgress = {
  phase: 'idle',
  totalBatches: 0,
  doneBatches: 0,
  totalIds: 0,
  doneIds: 0,
};

/** Resuelve el nombre de un id cuando el backend no pudo devolverlo. */
export type CustomerNameResolver = (id: number) => string | undefined;

@Injectable({ providedIn: 'root' })
export class CustomersBulkEditService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly baseUrl = `${environment.apiUrl}/store/customers/bulk-edit`;

  private readonly progressState = signal<BulkCustomerProgress>(IDLE_PROGRESS);

  /** Progreso del troceado en curso. Señal de solo lectura. */
  readonly progress = this.progressState.asReadonly();

  resetProgress(): void {
    this.progressState.set(IDLE_PROGRESS);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Selección
  // ───────────────────────────────────────────────────────────────────────────

  /** Una página del panel con su total (para `app-pagination`). */
  getPage(
    filters: BulkCustomerFilters,
    page: number,
    limit: number,
  ): Observable<BulkCustomerPage> {
    return this.http
      .get<
        ApiEnvelope<BulkCustomerRow[]>
      >(`${this.baseUrl}/list`, { params: this.buildParams(filters, page, limit) })
      .pipe(
        map((res) => ({
          data: res.data ?? [],
          total: res.meta?.total ?? (res.data ?? []).length,
        })),
      );
  }

  /**
   * Hidrata el stack con clientes que no están en la página cargada (los que
   * trajo «seleccionar todos los del filtro»). Trocea igual que la escritura.
   */
  getByIds(ids: readonly number[]): Observable<BulkCustomerRow[]> {
    const batches = chunk([...ids], MAX_BULK_EDIT_CUSTOMER_IDS);
    if (batches.length === 0) {
      return of([]);
    }
    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .get<ApiEnvelope<BulkCustomerRow[]>>(`${this.baseUrl}/list`, {
            params: this.buildParams({}, 1, batch.length).set(
              'ids',
              batch.join(','),
            ),
          })
          .pipe(
            map((res) => res.data ?? []),
            // Una hidratación fallida degrada la ficha del stack, no la
            // operación: los ids siguen seleccionados y el backend los editará.
            catchError(() => of([] as BulkCustomerRow[])),
          ),
      ),
      toArray(),
      map((parts) => parts.flat()),
    );
  }

  /** Ids que cumplen el filtro, para «seleccionar todos los que cumplen». */
  getIds(filters: BulkCustomerFilters): Observable<BulkCustomerIdsResult> {
    return this.http
      .get<
        ApiEnvelope<BulkCustomerIdsResult>
      >(`${this.baseUrl}/ids`, { params: this.buildParams(filters) })
      .pipe(map((res) => res.data));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Preview y aplicación (troceadas)
  // ───────────────────────────────────────────────────────────────────────────

  /** Dry-run troceado: devuelve UN informe agregado de todos los lotes. */
  previewInBatches(
    ids: readonly number[],
    changes: BulkEditableCustomerChanges,
    resolveName?: CustomerNameResolver,
  ): Observable<BulkCustomerPreviewResult> {
    const batches = this.startPhase('preview', ids);
    if (batches.length === 0) {
      return of({
        total: 0,
        ok: 0,
        warnings: 0,
        errors: 0,
        tier_overwrite_count: 0,
        items: [],
      });
    }

    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post<
            ApiEnvelope<BulkCustomerPreviewResult>
          >(`${this.baseUrl}/preview`, { ids: batch, changes })
          .pipe(
            map((res) => res.data),
            catchError((err: unknown) =>
              of(this.previewFallback(batch, err, resolveName)),
            ),
            tap(() => this.advance(batch.length)),
          ),
      ),
      toArray(),
      map((parts) => mergePreviewResults(parts)),
    );
  }

  /** Aplicación troceada: un lote caído no detiene los siguientes. */
  applyInBatches(
    ids: readonly number[],
    changes: BulkEditableCustomerChanges,
    resolveName?: CustomerNameResolver,
  ): Observable<BulkCustomerResult> {
    const batches = this.startPhase('apply', ids);
    if (batches.length === 0) {
      return of({ total: 0, successful: 0, skipped: 0, failed: 0, results: [] });
    }

    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post<
            ApiEnvelope<BulkCustomerResult>
          >(this.baseUrl, { ids: batch, changes })
          .pipe(
            map((res) => res.data),
            catchError((err: unknown) =>
              of(this.applyFallback(batch, err, resolveName)),
            ),
            tap(() => this.advance(batch.length)),
          ),
      ),
      toArray(),
      map((parts) => mergeApplyResults(parts)),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internos
  // ───────────────────────────────────────────────────────────────────────────

  private startPhase(
    phase: Exclude<BulkCustomerProgress['phase'], 'idle'>,
    ids: readonly number[],
  ): number[][] {
    const batches = chunk([...ids], MAX_BULK_EDIT_CUSTOMER_IDS);
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

  /** Lote de preview caído → todos sus ids en `error` con el motivo. */
  private previewFallback(
    batch: readonly number[],
    err: unknown,
    resolveName?: CustomerNameResolver,
  ): BulkCustomerPreviewResult {
    const { errorCode, userMessage } = parseApiError(err);
    const items: BulkCustomerPreviewItem[] = batch.map((id) => ({
      id,
      name: resolveName?.(id) ?? `Cliente #${id}`,
      document_number: null,
      status: 'error',
      changes: [],
      code: errorCode ?? undefined,
      message: userMessage,
    }));
    return {
      total: batch.length,
      ok: 0,
      warnings: 0,
      errors: batch.length,
      tier_overwrite_count: 0,
      items,
    };
  }

  /** Lote de aplicación caído → todos sus ids como fallidos, nunca perdidos. */
  private applyFallback(
    batch: readonly number[],
    err: unknown,
    resolveName?: CustomerNameResolver,
  ): BulkCustomerResult {
    const { errorCode, userMessage } = parseApiError(err);
    const results: BulkCustomerResultItem[] = batch.map((id) => ({
      id,
      name: resolveName?.(id) ?? `Cliente #${id}`,
      status: 'error',
      code: errorCode ?? undefined,
      message: userMessage,
    }));
    return { total: batch.length, successful: 0, skipped: 0, failed: batch.length, results };
  }

  /**
   * Serializa filtros + paginación.
   *
   * Los vacíos se OMITEN (mandar `state=` haría que Prisma lo tomara como un
   * estado literal y el listado saldría vacío), y los arreglos van en CSV, que
   * es la forma que el `@Transform` del DTO acepta y la misma que usa el
   * listado de clientes.
   */
  private buildParams(
    filters: BulkCustomerFilters,
    page?: number,
    limit?: number,
  ): HttpParams {
    let params = new HttpParams();

    // `page`/`limit` solo van donde el DTO los declara: `/ids` valida con
    // `BulkCustomerFilterDto`, que no los tiene, y el `forbidNonWhitelisted`
    // global rechazaría la petición entera con HTTP 400.
    if (page !== undefined) {
      params = params.set('page', String(page));
    }
    if (limit !== undefined) {
      params = params.set('limit', String(limit));
    }

    const scalar: Array<keyof BulkCustomerFilters> = [
      'search',
      'state',
      'city',
      'state_province',
      'created_from',
      'created_to',
    ];
    for (const key of scalar) {
      const value = filters[key];
      if (typeof value === 'string' && value.trim()) {
        params = params.set(key, value.trim());
      }
    }

    if (filters.price_tier_id) {
      params = params.set('price_tier_id', String(filters.price_tier_id));
    }
    // Solo se envía cuando es `true`: `false` equivale a no filtrar.
    if (filters.without_price_tier) {
      params = params.set('without_price_tier', 'true');
    }
    if (filters.tag_ids?.length) {
      params = params.set('tag_ids', filters.tag_ids.join(','));
    }
    if (filters.segment_ids?.length) {
      params = params.set('segment_ids', filters.segment_ids.join(','));
    }

    return params;
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

export function mergePreviewResults(
  parts: readonly BulkCustomerPreviewResult[],
): BulkCustomerPreviewResult {
  return parts.reduce<BulkCustomerPreviewResult>(
    (acc, part) => ({
      total: acc.total + (part?.total ?? 0),
      ok: acc.ok + (part?.ok ?? 0),
      warnings: acc.warnings + (part?.warnings ?? 0),
      errors: acc.errors + (part?.errors ?? 0),
      tier_overwrite_count:
        acc.tier_overwrite_count + (part?.tier_overwrite_count ?? 0),
      items: [...acc.items, ...(part?.items ?? [])],
    }),
    {
      total: 0,
      ok: 0,
      warnings: 0,
      errors: 0,
      tier_overwrite_count: 0,
      items: [],
    },
  );
}

export function mergeApplyResults(
  parts: readonly BulkCustomerResult[],
): BulkCustomerResult {
  return parts.reduce<BulkCustomerResult>(
    (acc, part) => ({
      total: acc.total + (part?.total ?? 0),
      successful: acc.successful + (part?.successful ?? 0),
      skipped: acc.skipped + (part?.skipped ?? 0),
      failed: acc.failed + (part?.failed ?? 0),
      results: [...acc.results, ...(part?.results ?? [])],
    }),
    { total: 0, successful: 0, skipped: 0, failed: 0, results: [] },
  );
}
