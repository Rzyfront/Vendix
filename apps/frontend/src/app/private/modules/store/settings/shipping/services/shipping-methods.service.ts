import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  SystemShippingMethod,
  StoreShippingMethod,
  ShippingMethodStats,
  EnableShippingMethodDto,
  UpdateStoreShippingMethodDto,
  ReorderShippingMethodsDto,
} from '../interfaces/shipping-methods.interface';

@Injectable({
  providedIn: 'root',
})
export class ShippingMethodsService {
  private readonly api_base_url = `${environment.apiUrl}/store`;

  constructor(private http: HttpClient) {}

  getStoreShippingMethods(): Observable<StoreShippingMethod[]> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-methods`)
      .pipe(
        map((response: any) => {
          if (response.success && response.data) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError)
      );
  }

  getAvailableShippingMethods(): Observable<SystemShippingMethod[]> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-methods/available`)
      .pipe(
        map((response: any) => {
          if (response.success && response.data) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError)
      );
  }

  getShippingMethod(method_id: number): Observable<StoreShippingMethod> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-methods/${method_id}`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  enableShippingMethod(
    system_method_id: number,
    data: EnableShippingMethodDto
  ): Observable<StoreShippingMethod> {
    return this.http
      .post<any>(
        `${this.api_base_url}/shipping-methods/enable/${system_method_id}`,
        data
      )
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  updateStoreShippingMethod(
    method_id: number,
    data: UpdateStoreShippingMethodDto
  ): Observable<StoreShippingMethod> {
    return this.http
      .patch<any>(`${this.api_base_url}/shipping-methods/${method_id}`, data)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  disableShippingMethod(method_id: number): Observable<StoreShippingMethod> {
    return this.http
      .patch<any>(
        `${this.api_base_url}/shipping-methods/${method_id}/disable`,
        {}
      )
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  enableStoreShippingMethod(method_id: number): Observable<StoreShippingMethod> {
    return this.http
      .patch<any>(
        `${this.api_base_url}/shipping-methods/${method_id}/enable`,
        {}
      )
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  deleteShippingMethod(method_id: number): Observable<void> {
    return this.http
      .delete<any>(`${this.api_base_url}/shipping-methods/${method_id}`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  reorderShippingMethods(
    data: ReorderShippingMethodsDto
  ): Observable<StoreShippingMethod[]> {
    return this.http
      .post<any>(`${this.api_base_url}/shipping-methods/reorder`, data)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  getShippingMethodStats(): Observable<ShippingMethodStats> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-methods/stats`)
      .pipe(
        map((response: any) => {
          if (response.success && response.data) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError)
      );
  }

  private handleError(error: any): Observable<never> {
    let error_message = 'An unknown error occurred';

    if (error.error instanceof ErrorEvent) {
      error_message = error.error.message;
    } else if (error.error && error.error.message) {
      error_message = error.error.message;
    } else if (error.message) {
      error_message = error.message;
    }

    console.error('ShippingMethodsService error:', error);
    return throwError(() => new Error(error_message));
  }

  getShippingMethodIcon(type: string): string {
    const icon_map: Record<string, string> = {
      custom: 'package',
      pickup: 'store',
      own_fleet: 'truck',
      carrier: 'send',
      third_party_provider: 'globe',
    };
    return icon_map[type] || 'truck';
  }

  getShippingMethodTypeLabel(type: string): string {
    const label_map: Record<string, string> = {
      custom: 'Personalizado',
      pickup: 'Recogida en tienda',
      own_fleet: 'Flota propia',
      carrier: 'Transportadora',
      third_party_provider: 'Proveedor externo',
    };
    return label_map[type] || type;
  }

  getShippingMethodStateLabel(state: string): string {
    const label_map: Record<string, string> = {
      enabled: 'Activo',
      disabled: 'Inactivo',
      archived: 'Archivado',
    };
    return label_map[state] || state;
  }

  getShippingMethodStateColor(state: string): string {
    const color_map: Record<string, string> = {
      enabled: 'success',
      disabled: 'warning',
      archived: 'neutral',
    };
    return color_map[state] || 'neutral';
  }

  formatDeliveryTime(min_days?: number, max_days?: number): string {
    if (!min_days && !max_days) return '-';
    if (min_days === max_days) return `${min_days} días`;
    if (!max_days) return `${min_days}+ días`;
    return `${min_days}-${max_days} días`;
  }
}
