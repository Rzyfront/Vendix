import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { environment } from '../../../../../../../environments/environment';
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

/**
 * Lo que la vista avanzada necesita de cada superficie (tienda u
 * organización). La pantalla es una sola; cada superficie aporta sus
 * endpoints, su ruta de regreso y sus bodegas (D7: el scope decide qué ve).
 */
export interface TransferAdvancedApi {
  readonly surface: 'store' | 'organization';
  /** Lista de transferencias (regreso y destino tras crear). */
  readonly listRoute: string;
  /** Clave del borrador local: separa tienda y organización. */
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
  getLocationStock(
    fromLocationId: number,
    toLocationId: number | null,
    categoryId: number | null,
  ): Observable<TransferPickerRow[]>;
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
  protected abstract readonly baseUrl: string;
  abstract readonly surface: 'store' | 'organization';
  abstract readonly listRoute: string;
  abstract readonly draftStorageKey: string;
  abstract getLocations(): Observable<TransferLocationOption[]>;

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
  ): Observable<TransferPickerRow[]> {
    let params = new HttpParams()
      .set('from_location_id', String(from))
      .set('limit', '500');
    if (to) params = params.set('to_location_id', String(to));
    if (categoryId) params = params.set('category_id', String(categoryId));
    return this.http
      .get<any>(`${this.baseUrl}/location-stock`, { params })
      .pipe(
        map((r) => {
          const data = unwrap<TransferPickerRow[]>(r);
          return Array.isArray(data) ? data : [];
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
  readonly draftStorageKey = 'vendix.transfers.advanced-draft.store';

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
  readonly draftStorageKey = 'vendix.transfers.advanced-draft.organization';

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
