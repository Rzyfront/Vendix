/**
 * Servicio HTTP del módulo de edición masiva de productos (QUI-567).
 *
 * ## Por qué vive aquí y no en `services/products.service.ts`
 *
 * Todo lo que este servicio expone es exclusivo del flujo de edición masiva
 * (troceado en lotes, progreso, agregación de resultados parciales). Mantenerlo
 * en el módulo evita engordar el servicio compartido de productos, que ya lo
 * consumen el listado, el POS, el catálogo y el formulario individual.
 *
 * ## El troceado es responsabilidad del cliente, por contrato
 *
 * `BulkEditProductsDto` declara `@ArrayMaxSize(100)`, así que un lote de 101
 * ids devuelve 400 del `ValidationPipe` global. El backend NO trocea: expone un
 * tope y lo hace cumplir. Por tanto el cliente:
 *
 *  1. Parte la selección en lotes de `MAX_BULK_EDIT_IDS`.
 *  2. Los envía **en serie** (`concatMap`, no `mergeMap`): cada lote son N
 *     transacciones fila por fila en el backend, y paralelizarlos multiplicaría
 *     la presión sobre el pool de conexiones sin ganancia perceptible.
 *  3. **No aborta la cadena cuando un lote falla.** El `catchError` está DENTRO
 *     del `concatMap`, así que degrada ese lote a "todos sus ids fallaron" y
 *     continúa con el siguiente. Un 500 en el lote 2 de 5 no puede dejar al
 *     operador sin saber qué pasó con los lotes 3, 4 y 5.
 *  4. Agrega los resultados de TODOS los lotes en un único informe.
 *
 * El progreso se publica como señal (`progress`) para que la barra de la UI sea
 * reactiva sin que ningún componente tenga que suscribirse a nada.
 */

import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, concatMap, from, map, of, toArray } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import { environment } from '../../../../../../environments/environment';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import type { Product, ProductQueryDto } from '../interfaces';
import {
  MAX_BULK_EDIT_IDS,
  type BulkEditPreviewItem,
  type BulkEditPreviewResult,
  type BulkEditResult,
  type BulkEditResultItem,
  type BulkEditableChanges,
} from './bulk-edit.interface';

/** Envoltorio estándar de `ResponseService` del backend. */
interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: unknown;
}

/**
 * Query de productos ampliada con `ids`.
 *
 * El backend ya acepta `ids` en `ProductQueryDto`
 * (`apps/backend/.../products/dto/index.ts:834-847`, con `@Transform` que admite
 * `?ids=1&ids=2` y `?ids=1,2`), pero la interfaz espejo del frontend vive en
 * `interfaces/product.interface.ts`, archivo fuera del alcance de este módulo.
 * Se extiende aquí en lugar de editarlo.
 */
export type BulkEditProductQuery = ProductQueryDto & { ids?: number[] };

/** Respuesta de `GET /store/products/ids`. */
export interface ProductIdsResult {
  ids: number[];
  total: number;
  /**
   * `true` cuando el filtro devuelve más ids que el tope del endpoint
   * (`MAX_PRODUCT_IDS = 1000`). La UI debe decirlo en voz alta: la selección
   * quedó recortada y el operador tiene que estrechar el filtro.
   */
  capped: boolean;
}

/** Fase del troceado, para que la UI sepa qué está midiendo la barra. */
export type BulkEditProgressPhase = 'idle' | 'preview' | 'apply';

export interface BulkEditProgress {
  phase: BulkEditProgressPhase;
  totalBatches: number;
  doneBatches: number;
  totalIds: number;
  doneIds: number;
}

const IDLE_PROGRESS: BulkEditProgress = {
  phase: 'idle',
  totalBatches: 0,
  doneBatches: 0,
  totalIds: 0,
  doneIds: 0,
};

/** Resuelve el nombre de un id cuando el backend no pudo devolverlo. */
export type ProductNameResolver = (id: number) => string | undefined;

/** Página de resultados con su total, para alimentar `app-pagination`. */
export interface ProductPageResult {
  data: Product[];
  total: number;
}

/** `meta` del envoltorio paginado de `ResponseService.paginated()`. */
interface PaginatedMeta {
  total?: number;
}

@Injectable({ providedIn: 'root' })
export class ProductsBulkEditService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  private readonly progressState = signal<BulkEditProgress>(IDLE_PROGRESS);

  /** Progreso del troceado en curso. Señal de solo lectura para la barra. */
  readonly progress = this.progressState.asReadonly();

  /** Vuelve el progreso a cero (al cerrar el modal, p. ej.). */
  resetProgress(): void {
    this.progressState.set(IDLE_PROGRESS);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Selección
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Una página de resultados del listado, con `meta.total`.
   *
   * Se lee aquí y no en `products.service.ts` porque ese servicio está fuera del
   * alcance de este módulo; además, esta vista necesita el `total` crudo para
   * `app-pagination` y para redactar "seleccionar los N del filtro", y no la
   * forma enriquecida que consume el listado principal.
   */
  getProductsPage(
    query: BulkEditProductQuery = {},
  ): Observable<ProductPageResult> {
    return this.http
      .get<
        ApiEnvelope<Product[]>
      >(`${this.apiUrl}/store/products`, { params: this.buildParams(query) })
      .pipe(
        map((res) => {
          const data = res.data ?? [];
          const meta = (res.meta ?? {}) as PaginatedMeta;
          return { data, total: meta.total ?? data.length };
        }),
      );
  }

  /**
   * Catálogo de plantillas de recolección de datos, para los selectores
   * `consultation_template_id` / `preconsultation_template_id`.
   *
   * Mismo endpoint que consume `loadDataCollectionTemplates()` del formulario
   * individual. Degrada a lista vacía: sin plantillas los dos selectores quedan
   * sin opciones, que es exactamente lo que debe pasar.
   */
  getDataCollectionTemplates(): Observable<
    { value: number; label: string }[]
  > {
    return this.http
      .get<
        ApiEnvelope<{ id: number; name: string }[]>
      >(`${this.apiUrl}/store/data-collection/templates`)
      .pipe(
        map((res) =>
          (res.data ?? []).map((template) => ({
            value: template.id,
            label: template.name,
          })),
        ),
        catchError(() => of([] as { value: number; label: string }[])),
      );
  }

  /**
   * Ids que satisfacen un filtro, para "seleccionar todos los resultados" sin
   * materializar productos completos.
   */
  getProductIds(query: BulkEditProductQuery = {}): Observable<ProductIdsResult> {
    return this.http
      .get<
        ApiEnvelope<ProductIdsResult>
      >(`${this.apiUrl}/store/products/ids`, { params: this.buildParams(query) })
      .pipe(map((res) => res.data));
  }

  /**
   * Hidrata el stack con productos que no están en la página cargada.
   *
   * Trocea igual que la edición: `?ids=` con 500 valores sería una URL absurda,
   * y el `limit` se fija al tamaño del lote porque `findAll` pagina con
   * `limit = 10` por defecto y devolvería solo los 10 primeros.
   */
  getProductsByIds(ids: readonly number[]): Observable<Product[]> {
    const batches = chunk([...ids], MAX_BULK_EDIT_IDS);
    if (batches.length === 0) {
      return of([]);
    }

    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .get<ApiEnvelope<Product[]>>(`${this.apiUrl}/store/products`, {
            params: this.buildParams({
              ids: batch,
              page: 1,
              limit: batch.length,
            }),
          })
          .pipe(
            map((res) => res.data ?? []),
            // Una hidratación fallida degrada la ficha del stack, no la
            // operación: los ids siguen seleccionados y el backend los editará.
            catchError(() => of([] as Product[])),
          ),
      ),
      toArray(),
      map((parts) => parts.flat()),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Preview y aplicación (troceadas)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Dry-run troceado. Devuelve UN informe agregado de todos los lotes.
   */
  previewInBatches(
    ids: readonly number[],
    changes: BulkEditableChanges,
    resolveName?: ProductNameResolver,
  ): Observable<BulkEditPreviewResult> {
    const batches = this.startPhase('preview', ids);
    if (batches.length === 0) {
      return of({ total: 0, ok: 0, warnings: 0, errors: 0, items: [] });
    }

    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post<
            ApiEnvelope<BulkEditPreviewResult>
          >(`${this.apiUrl}/store/products/bulk-edit/preview`, { ids: batch, changes })
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

  /**
   * Aplicación troceada. Un lote que falla NO detiene los siguientes y sus ids
   * aparecen como fallidos en el informe final, nunca desaparecen.
   */
  applyInBatches(
    ids: readonly number[],
    changes: BulkEditableChanges,
    resolveName?: ProductNameResolver,
  ): Observable<BulkEditResult> {
    const batches = this.startPhase('apply', ids);
    if (batches.length === 0) {
      return of({ total: 0, successful: 0, failed: 0, results: [] });
    }

    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post<
            ApiEnvelope<BulkEditResult>
          >(`${this.apiUrl}/store/products/bulk-edit`, { ids: batch, changes })
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
    phase: Exclude<BulkEditProgressPhase, 'idle'>,
    ids: readonly number[],
  ): number[][] {
    const batches = chunk([...ids], MAX_BULK_EDIT_IDS);
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

  /** Lote de preview caído → todos sus ids en estado `error` con el motivo. */
  private previewFallback(
    batch: readonly number[],
    err: unknown,
    resolveName?: ProductNameResolver,
  ): BulkEditPreviewResult {
    const { errorCode, userMessage } = parseApiError(err);
    const items: BulkEditPreviewItem[] = batch.map((id) => ({
      id,
      name: resolveName?.(id) ?? `Producto #${id}`,
      sku: null,
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
      items,
    };
  }

  /** Lote de aplicación caído → todos sus ids como fallidos, nunca perdidos. */
  private applyFallback(
    batch: readonly number[],
    err: unknown,
    resolveName?: ProductNameResolver,
  ): BulkEditResult {
    const { errorCode, userMessage } = parseApiError(err);
    const results: BulkEditResultItem[] = batch.map((id) => ({
      id,
      name: resolveName?.(id) ?? `Producto #${id}`,
      status: 'error',
      code: errorCode ?? undefined,
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
   * Serializa la query. Omite vacíos (para no mandar `state=` y que el backend
   * lo interprete como filtro) y aplana arrays en CSV, la forma que el
   * `@Transform` de `ProductQueryDto.ids` acepta.
   */
  private buildParams(query: BulkEditProductQuery): HttpParams {
    let params = new HttpParams();
    for (const [key, raw] of Object.entries(query)) {
      if (raw === undefined || raw === null || raw === '') {
        continue;
      }
      if (Array.isArray(raw)) {
        if (raw.length === 0) {
          continue;
        }
        params = params.set(key, raw.join(','));
        continue;
      }
      params = params.set(key, String(raw));
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

/** Suma los informes de preview de todos los lotes en uno solo. */
export function mergePreviewResults(
  parts: readonly BulkEditPreviewResult[],
): BulkEditPreviewResult {
  return parts.reduce<BulkEditPreviewResult>(
    (acc, part) => ({
      total: acc.total + (part?.total ?? 0),
      ok: acc.ok + (part?.ok ?? 0),
      warnings: acc.warnings + (part?.warnings ?? 0),
      errors: acc.errors + (part?.errors ?? 0),
      items: [...acc.items, ...(part?.items ?? [])],
    }),
    { total: 0, ok: 0, warnings: 0, errors: 0, items: [] },
  );
}

/** Suma los informes de aplicación de todos los lotes en uno solo. */
export function mergeApplyResults(
  parts: readonly BulkEditResult[],
): BulkEditResult {
  return parts.reduce<BulkEditResult>(
    (acc, part) => ({
      total: acc.total + (part?.total ?? 0),
      successful: acc.successful + (part?.successful ?? 0),
      failed: acc.failed + (part?.failed ?? 0),
      results: [...acc.results, ...(part?.results ?? [])],
    }),
    { total: 0, successful: 0, failed: 0, results: [] },
  );
}
