import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { environment } from '../../../../../../../environments/environment';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import type { TransferPickerRow } from '../quick-move/transfer-draft';
import type {
  AdvancedTransferPayload,
  TransferAdvancedOptions,
  TransferBatchOption,
} from './transfer-advanced';

export interface TransferLocationOption {
  value: number;
  label: string;
}

/** "Todo el stock de la bodega": filas y si quedaron más fuera del tope. */
export interface TransferLocationStockPage {
  rows: TransferPickerRow[];
  has_more: boolean;
  limit: number;
}

/**
 * Lo que la vista avanzada necesita de cada superficie (tienda u
 * organización). La pantalla es una sola; cada superficie aporta sus
 * endpoints, su ruta de regreso y sus bodegas (D7: el scope decide qué ve).
 */
export interface TransferAdvancedApi {
  readonly surface: 'store' | 'organization';
  /** Lista de transferencias (regreso y destino tras crear). */
  readonly listRoute: string;
  /**
   * Clave del borrador local: separa superficie, usuario y tienda u
   * organización, para que en un equipo compartido nadie retome datos ajenos.
   */
  readonly draftStorageKey: string;
  getLocations(): Observable<TransferLocationOption[]>;
  searchProducts(
    term: string,
    fromLocationId: number,
    toLocationId: number,
  ): Observable<TransferPickerRow[]>;
  getOptions(fromLocationId: number): Observable<TransferAdvancedOptions>;
  getBatches(
    fromLocationId: number,
    productIds: number[],
  ): Observable<TransferBatchOption[]>;
  /**
   * Escáner y "pegar lista": coincidencia exacta del código con el SKU o el
   * código de barras del producto o de la variante, con stock en el origen.
   */
  lookupCode(
    code: string,
    fromLocationId: number,
    toLocationId: number | null,
  ): Observable<TransferPickerRow[]>;
  /** `productIds` limita a esos productos (refrescar disponibles). */
  getLocationStock(
    fromLocationId: number,
    toLocationId: number | null,
    categoryId: number | null,
    productIds?: number[],
  ): Observable<TransferLocationStockPage>;
  create(
    payload: AdvancedTransferPayload,
  ): Observable<{ id: number; transfer_number?: string }>;
}

export const TRANSFER_ADVANCED_API = new InjectionToken<TransferAdvancedApi>(
  'TRANSFER_ADVANCED_API',
  {
    providedIn: 'root',
    factory: () => inject(StoreTransferAdvancedApi),
  },
);

function unwrap<T>(r: any): T {
  return (r && typeof r === 'object' && 'data' in r ? r.data : r) as T;
}

function apiError(error: any): Error {
  const msg =
    error?.error?.message ||
    error?.error?.error ||
    error?.message ||
    'Error desconocido';
  return new Error(Array.isArray(msg) ? msg.join('. ') : String(msg));
}

/** Implementación común: las dos superficies exponen las mismas rutas. */
abstract class BaseTransferAdvancedApi implements TransferAdvancedApi {
  protected readonly http = inject(HttpClient);
  protected readonly auth = inject(AuthFacade);
  protected abstract readonly baseUrl: string;
  abstract readonly surface: 'store' | 'organization';
  abstract readonly listRoute: string;
  abstract get draftStorageKey(): string;
  abstract getLocations(): Observable<TransferLocationOption[]>;

  /** Usuario de la sesión para la clave del borrador (`x` si no hay). */
  protected draftUserPart(): string {
    return `u${this.auth.userId() ?? 'x'}`;
  }

  lookupCode(
    code: string,
    from: number,
    to: number | null,
  ): Observable<TransferPickerRow[]> {
    let params = new HttpParams()
      .set('code', code)
      .set('from_location_id', String(from));
    if (to) params = params.set('to_location_id', String(to));
    return this.http.get<any>(`${this.baseUrl}/lookup-code`, { params }).pipe(
      map((r) => {
        const data = unwrap<TransferPickerRow[]>(r);
        return Array.isArray(data) ? data : [];
      }),
      catchError((e) => throwError(() => apiError(e))),
    );
  }

  searchProducts(
    term: string,
    from: number,
    to: number,
  ): Observable<TransferPickerRow[]> {
    const params = new HttpParams()
      .set('search', term)
      .set('from_location_id', String(from))
      .set('to_location_id', String(to))
      .set('limit', '30');
    return this.http
      .get<any>(`${this.baseUrl}/search-products`, { params })
      .pipe(
        map((r) => {
          const data = unwrap<TransferPickerRow[]>(r);
          return Array.isArray(data) ? data : [];
        }),
        catchError((e) => throwError(() => apiError(e))),
      );
  }

  getOptions(from: number): Observable<TransferAdvancedOptions> {
    const params = new HttpParams().set('from_location_id', String(from));
    return this.http
      .get<any>(`${this.baseUrl}/advanced-options`, { params })
      .pipe(
        map((r) => unwrap<TransferAdvancedOptions>(r)),
        catchError((e) => throwError(() => apiError(e))),
      );
  }

  getBatches(
    from: number,
    productIds: number[],
  ): Observable<TransferBatchOption[]> {
    const params = new HttpParams()
      .set('from_location_id', String(from))
      .set('product_ids', [...new Set(productIds)].join(','));
    return this.http.get<any>(`${this.baseUrl}/batches`, { params }).pipe(
      map((r) => {
        const data = unwrap<TransferBatchOption[]>(r);
        return Array.isArray(data) ? data : [];
      }),
      catchError((e) => throwError(() => apiError(e))),
    );
  }

  getLocationStock(
    from: number,
    to: number | null,
    categoryId: number | null,
    productIds: number[] = [],
  ): Observable<TransferLocationStockPage> {
    let params = new HttpParams()
      .set('from_location_id', String(from))
      .set('limit', '500');
    if (to) params = params.set('to_location_id', String(to));
    if (categoryId) params = params.set('category_id', String(categoryId));
    if (productIds.length > 0) {
      params = params.set('product_ids', [...new Set(productIds)].join(','));
    }
    return this.http
      .get<any>(`${this.baseUrl}/location-stock`, { params })
      .pipe(
        map((r) => {
          const data = unwrap<TransferPickerRow[]>(r);
          const meta = r && typeof r === 'object' ? r.meta : null;
          return {
            rows: Array.isArray(data) ? data : [],
            has_more: meta?.has_more === true,
            limit: Number(meta?.limit) || 500,
          };
        }),
        catchError((e) => throwError(() => apiError(e))),
      );
  }

  create(
    payload: AdvancedTransferPayload,
  ): Observable<{ id: number; transfer_number?: string }> {
    return this.http.post<any>(this.baseUrl, payload).pipe(
      map((r) => unwrap<{ id: number; transfer_number?: string }>(r)),
      catchError((e) => throwError(() => apiError(e))),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class StoreTransferAdvancedApi extends BaseTransferAdvancedApi {
  protected readonly baseUrl = `${environment.apiUrl}/store/stock-transfers`;
  readonly surface = 'store' as const;
  readonly listRoute = '/admin/inventory/transfers';

  get draftStorageKey(): string {
    const storeId = this.auth.userStore()?.id ?? 'x';
    return `vendix.transfers.advanced-draft.store.${this.draftUserPart()}.s${storeId}`;
  }

  getLocations(): Observable<TransferLocationOption[]> {
    return this.http
      .get<any>(`${environment.apiUrl}/store/inventory/locations`)
      .pipe(
        map((r) => {
          const rows = unwrap<any[]>(r);
          return (Array.isArray(rows) ? rows : []).map((l) => ({
            value: l.id,
            label: l.name,
          }));
        }),
        catchError((e) => throwError(() => apiError(e))),
      );
  }
}

@Injectable({ providedIn: 'root' })
export class OrgTransferAdvancedApi extends BaseTransferAdvancedApi {
  protected readonly baseUrl = `${environment.apiUrl}/organization/inventory/transfers`;
  readonly surface = 'organization' as const;
  readonly listRoute = '/admin/inventory/transfers';

  get draftStorageKey(): string {
    const orgId = this.auth.userOrganization()?.id ?? 'x';
    return `vendix.transfers.advanced-draft.organization.${this.draftUserPart()}.o${orgId}`;
  }

  getLocations(): Observable<TransferLocationOption[]> {
    const params = new HttpParams()
      .set('is_active', 'true')
      .set('limit', '200');
    return this.http
      .get<any>(`${environment.apiUrl}/organization/inventory/locations`, {
        params,
      })
      .pipe(
        map((r) => {
          const rows = unwrap<any[]>(r);
          return (Array.isArray(rows) ? rows : []).map((row) => ({
            value: row.id,
            label: `${row.name} · ${
              row.is_central_warehouse
                ? 'Bodega central'
                : row.store_name ||
                  (row.store_id ? `Tienda #${row.store_id}` : 'Sin tienda')
            }`,
          }));
        }),
        catchError((e) => throwError(() => apiError(e))),
      );
  }
}
