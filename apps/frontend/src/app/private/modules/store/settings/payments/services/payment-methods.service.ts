import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject, catchError, throwError } from 'rxjs';
import {
  SystemPaymentMethod,
  StorePaymentMethod,
  PaymentMethodStats,
  EnablePaymentMethodDto,
  UpdateStorePaymentMethodDto,
  ReorderPaymentMethodsDto,
  PaymentMethodsQueryParams,
  PaginatedPaymentMethods,
} from '../interfaces/payment-methods.interface';

@Injectable({
  providedIn: 'root',
})
export class PaymentMethodsService {
  private readonly api_base_url = 'store';
  private current_store_id = new BehaviorSubject<string | null>(null);

  constructor(private http: HttpClient) {}

  setCurrentStoreId(store_id: string): void {
    this.current_store_id.next(store_id);
  }

  getCurrentStoreId(): string | null {
    return this.current_store_id.value;
  }

  getStorePaymentMethods(
    params?: PaymentMethodsQueryParams,
  ): Observable<PaginatedPaymentMethods> {
    const store_id = this.getCurrentStoreId();
    if (!store_id) {
      return throwError(() => new Error('Store ID is required'));
    }

    let http_params = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          http_params = http_params.set(key, value.toString());
        }
      });
    }

    return this.http
      .get<PaginatedPaymentMethods>(
        `${this.api_base_url}/stores/${store_id}/payment-methods`,
        { params: http_params },
      )
      .pipe(catchError(this.handleError));
  }

  getAvailablePaymentMethods(): Observable<SystemPaymentMethod[]> {
    const store_id = this.getCurrentStoreId();
    if (!store_id) {
      return throwError(() => new Error('Store ID is required'));
    }

    return this.http
      .get<
        SystemPaymentMethod[]
      >(`${this.api_base_url}/stores/${store_id}/payment-methods/available`)
      .pipe(catchError(this.handleError));
  }

  getStorePaymentMethod(method_id: string): Observable<StorePaymentMethod> {
    const store_id = this.getCurrentStoreId();
    if (!store_id) {
      return throwError(() => new Error('Store ID is required'));
    }

    return this.http
      .get<StorePaymentMethod>(
        `${this.api_base_url}/stores/${store_id}/payment-methods/${method_id}`,
      )
      .pipe(catchError(this.handleError));
  }

  enablePaymentMethod(
    system_method_id: string,
    data: EnablePaymentMethodDto,
  ): Observable<StorePaymentMethod> {
    const store_id = this.getCurrentStoreId();
    if (!store_id) {
      return throwError(() => new Error('Store ID is required'));
    }

    return this.http
      .post<StorePaymentMethod>(
        `${this.api_base_url}/stores/${store_id}/payment-methods/enable/${system_method_id}`,
        data,
      )
      .pipe(catchError(this.handleError));
  }

  updateStorePaymentMethod(
    method_id: string,
    data: UpdateStorePaymentMethodDto,
  ): Observable<StorePaymentMethod> {
    const store_id = this.getCurrentStoreId();
    if (!store_id) {
      return throwError(() => new Error('Store ID is required'));
    }

    return this.http
      .patch<StorePaymentMethod>(
        `${this.api_base_url}/stores/${store_id}/payment-methods/${method_id}`,
        data,
      )
      .pipe(catchError(this.handleError));
  }

  disablePaymentMethod(method_id: string): Observable<StorePaymentMethod> {
    const store_id = this.getCurrentStoreId();
    if (!store_id) {
      return throwError(() => new Error('Store ID is required'));
    }

    return this.http
      .patch<StorePaymentMethod>(
        `${this.api_base_url}/stores/${store_id}/payment-methods/${method_id}/disable`,
        {},
      )
      .pipe(catchError(this.handleError));
  }

  deletePaymentMethod(method_id: string): Observable<void> {
    const store_id = this.getCurrentStoreId();
    if (!store_id) {
      return throwError(() => new Error('Store ID is required'));
    }

    return this.http
      .delete<void>(
        `${this.api_base_url}/stores/${store_id}/payment-methods/${method_id}`,
      )
      .pipe(catchError(this.handleError));
  }

  reorderPaymentMethods(
    data: ReorderPaymentMethodsDto,
  ): Observable<StorePaymentMethod[]> {
    const store_id = this.getCurrentStoreId();
    if (!store_id) {
      return throwError(() => new Error('Store ID is required'));
    }

    return this.http
      .post<
        StorePaymentMethod[]
      >(`${this.api_base_url}/stores/${store_id}/payment-methods/reorder`, data)
      .pipe(catchError(this.handleError));
  }

  getPaymentMethodStats(): Observable<PaymentMethodStats> {
    const store_id = this.getCurrentStoreId();
    if (!store_id) {
      return throwError(() => new Error('Store ID is required'));
    }

    return this.http
      .get<PaymentMethodStats>(
        `${this.api_base_url}/stores/${store_id}/payment-methods/stats`,
      )
      .pipe(catchError(this.handleError));
  }

  testPaymentMethodConfiguration(
    method_id: string,
    config: Record<string, any>,
  ): Observable<{ success: boolean; message?: string }> {
    const store_id = this.getCurrentStoreId();
    if (!store_id) {
      return throwError(() => new Error('Store ID is required'));
    }

    return this.http
      .post<{
        success: boolean;
        message?: string;
      }>(
        `${this.api_base_url}/stores/${store_id}/payment-methods/${method_id}/test`,
        { config },
      )
      .pipe(catchError(this.handleError));
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

    console.error('PaymentMethodsService error:', error);
    return throwError(() => new Error(error_message));
  }

  getPaymentMethodIcon(type: string): string {
    const icon_map: Record<string, string> = {
      cash: 'dollar-sign',
      card: 'credit-card',
      paypal: 'globe',
      bank_transfer: 'building',
    };
    return icon_map[type] || 'payment';
  }

  getPaymentMethodTypeLabel(type: string): string {
    const label_map: Record<string, string> = {
      cash: 'Cash',
      card: 'Credit/Debit Card',
      paypal: 'PayPal',
      bank_transfer: 'Bank Transfer',
    };
    return label_map[type] || type;
  }

  getPaymentMethodStateLabel(state: string): string {
    const label_map: Record<string, string> = {
      enabled: 'Enabled',
      disabled: 'Disabled',
      archived: 'Archived',
      requires_configuration: 'Requires Configuration',
    };
    return label_map[state] || state;
  }

  getPaymentMethodStateColor(state: string): string {
    const color_map: Record<string, string> = {
      enabled: 'success',
      disabled: 'warning',
      archived: 'neutral',
      requires_configuration: 'info',
    };
    return color_map[state] || 'neutral';
  }
}
