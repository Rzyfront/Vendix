import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, finalize } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';

import {
  ApiResponse,
  PaginatedApiResponse,
  StoreActivityDetail,
  StoreActivityDetailQuery,
  StoreActivityQuery,
  StoreActivityRow,
  StoreActivityStats,
} from '../contracts/store-activity.contract';

/**
 * Cliente HTTP del submódulo super-admin `Cuentas > Actividad`.
 *
 * Lee los tres endpoints de lectura del dominio
 * `superadmin/stores/activity` (solo `SUPER_ADMIN` en el backend):
 * ranking paginado, stats del encabezado y detalle por tienda.
 */
@Injectable({
  providedIn: 'root',
})
export class StoreActivityService {
  private readonly apiUrl = environment.apiUrl;
  private readonly http = inject(HttpClient);

  readonly isLoadingRanking = signal(false);
  readonly isLoadingStats = signal(false);
  readonly isLoadingDetail = signal(false);

  private readonly baseUrl = `${this.apiUrl}/superadmin/stores/activity`;

  getRanking(
    query: StoreActivityQuery = {},
  ): Observable<PaginatedApiResponse<StoreActivityRow>> {
    this.isLoadingRanking.set(true);
    return this.http
      .get<PaginatedApiResponse<StoreActivityRow>>(`${this.baseUrl}/ranking`, {
        params: this.toHttpParams(query),
      })
      .pipe(finalize(() => this.isLoadingRanking.set(false)));
  }

  getStats(
    query: StoreActivityQuery = {},
  ): Observable<ApiResponse<StoreActivityStats>> {
    this.isLoadingStats.set(true);
    const { page: _page, limit: _limit, sort, order, ...rest } = query;
    void _page;
    void _limit;
    void sort;
    void order;
    return this.http
      .get<ApiResponse<StoreActivityStats>>(`${this.baseUrl}/stats`, {
        params: this.toHttpParams(rest),
      })
      .pipe(finalize(() => this.isLoadingStats.set(false)));
  }

  getDetail(
    storeId: number,
    query: StoreActivityDetailQuery = {},
  ): Observable<ApiResponse<StoreActivityDetail>> {
    this.isLoadingDetail.set(true);
    return this.http
      .get<ApiResponse<StoreActivityDetail>>(`${this.baseUrl}/${storeId}`, {
        params: this.toHttpParams(query),
      })
      .pipe(finalize(() => this.isLoadingDetail.set(false)));
  }

  private toHttpParams(
    query: StoreActivityQuery | StoreActivityDetailQuery,
  ): HttpParams {
    let params = new HttpParams();
    for (const [key, raw] of Object.entries(query)) {
      if (raw === undefined || raw === null || raw === '') continue;
      params = params.set(key, String(raw));
    }
    return params;
  }
}
