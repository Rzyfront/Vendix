import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  CompleteManufacturingOrderDto,
  CreateManufacturingOrderDto,
  ManufacturingOrder,
  ManufacturingOrderQuery,
  ManufacturingShortage,
  UpdateManufacturingOrderDto,
} from '../interfaces';
import {
  ApiResponse,
  PaginatedApiResponse,
  handleManufacturingError,
} from './manufacturing-api.util';

/** Órdenes de producción de manufactura (`/store/manufacturing/orders`). */
@Injectable({ providedIn: 'root' })
export class ManufacturingOrdersService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/manufacturing/orders';
  private readonly http = inject(HttpClient);

  listPaginated(
    query: ManufacturingOrderQuery = {},
  ): Observable<PaginatedApiResponse<ManufacturingOrder>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.status) params = params.set('status', query.status);
    if (query.product_id != null) {
      params = params.set('product_id', String(query.product_id));
    }
    if (query.date_from) params = params.set('date_from', query.date_from);
    if (query.date_to) params = params.set('date_to', query.date_to);
    if (query.search) params = params.set('search', query.search);
    return this.http
      .get<PaginatedApiResponse<ManufacturingOrder>>(
        `${this.apiUrl}${this.basePath}`,
        { params },
      )
      .pipe(catchError((e) => handleManufacturingError(e)));
  }

  getById(id: number): Observable<ManufacturingOrder> {
    return this.http
      .get<ApiResponse<ManufacturingOrder>>(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e, 'Orden no encontrada')),
      );
  }

  create(dto: CreateManufacturingOrderDto): Observable<ManufacturingOrder> {
    return this.http
      .post<ApiResponse<ManufacturingOrder>>(`${this.apiUrl}${this.basePath}`, dto)
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  update(
    id: number,
    dto: UpdateManufacturingOrderDto,
  ): Observable<ManufacturingOrder> {
    return this.http
      .patch<ApiResponse<ManufacturingOrder>>(
        `${this.apiUrl}${this.basePath}/${id}`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  release(id: number): Observable<ManufacturingOrder> {
    return this.transition(id, 'release');
  }

  start(id: number): Observable<ManufacturingOrder> {
    return this.transition(id, 'start');
  }

  cancel(id: number): Observable<ManufacturingOrder> {
    return this.transition(id, 'cancel');
  }

  complete(
    id: number,
    dto: CompleteManufacturingOrderDto,
  ): Observable<ManufacturingOrder> {
    return this.http
      .post<ApiResponse<ManufacturingOrder>>(
        `${this.apiUrl}${this.basePath}/${id}/complete`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  getShortages(id: number): Observable<ManufacturingShortage[]> {
    return this.http
      .get<ApiResponse<ManufacturingShortage[]>>(
        `${this.apiUrl}${this.basePath}/${id}/shortages`,
      )
      .pipe(
        map((res) => res.data ?? []),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  private transition(
    id: number,
    action: 'release' | 'start' | 'cancel',
  ): Observable<ManufacturingOrder> {
    return this.http
      .post<ApiResponse<ManufacturingOrder>>(
        `${this.apiUrl}${this.basePath}/${id}/${action}`,
        {},
      )
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e)),
      );
  }
}
