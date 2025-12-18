import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
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
  private readonly api_base_url = `${environment.apiUrl}/store`;

  constructor(private http: HttpClient) {}

  getStorePaymentMethods(
    params?: PaymentMethodsQueryParams,
  ): Observable<PaginatedPaymentMethods> {
    let http_params = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          http_params = http_params.set(key, value.toString());
        }
      });
    }

    return this.http
      .get<any>(
        `${this.api_base_url}/payment-methods`,
        { params: http_params },
      )
      .pipe(
        // Extract data from ResponseService format
        map((response: any) => {
          if (response.success && response.data) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError)
      );
  }

  getAvailablePaymentMethods(): Observable<SystemPaymentMethod[]> {
    return this.http
      .get<any>(
        `${this.api_base_url}/payment-methods/available`
      )
      .pipe(
        // Extract data from ResponseService format
        map((response: any) => {
          if (response.success && response.data) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError)
      );
  }

  getStorePaymentMethod(method_id: string): Observable<StorePaymentMethod> {
    return this.http
      .get<StorePaymentMethod>(
        `${this.api_base_url}/payment-methods/${method_id}`,
      )
      .pipe(catchError(this.handleError));
  }

  enablePaymentMethod(
    system_method_id: string,
    data: EnablePaymentMethodDto,
  ): Observable<StorePaymentMethod> {
    return this.http
      .post<StorePaymentMethod>(
        `${this.api_base_url}/payment-methods/enable/${system_method_id}`,
        data,
      )
      .pipe(catchError(this.handleError));
  }

  updateStorePaymentMethod(
    method_id: string,
    data: UpdateStorePaymentMethodDto,
  ): Observable<StorePaymentMethod> {
    return this.http
      .patch<StorePaymentMethod>(
        `${this.api_base_url}/payment-methods/${method_id}`,
        data,
      )
      .pipe(catchError(this.handleError));
  }

  disablePaymentMethod(method_id: string): Observable<StorePaymentMethod> {
    return this.http
      .patch<StorePaymentMethod>(
        `${this.api_base_url}/payment-methods/${method_id}/disable`,
        {},
      )
      .pipe(catchError(this.handleError));
  }

  deletePaymentMethod(method_id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.api_base_url}/payment-methods/${method_id}`,
      )
      .pipe(catchError(this.handleError));
  }

  reorderPaymentMethods(
    data: ReorderPaymentMethodsDto,
  ): Observable<StorePaymentMethod[]> {
    return this.http
      .post<StorePaymentMethod[]>(
        `${this.api_base_url}/payment-methods/reorder`,
        data
      )
      .pipe(catchError(this.handleError));
  }

  getPaymentMethodStats(): Observable<PaymentMethodStats> {
    return this.http
      .get<any>(
        `${this.api_base_url}/payment-methods/stats`,
      )
      .pipe(
        // Extract data from ResponseService format
        map((response: any) => {
          if (response.success && response.data) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError)
      );
  }

  testPaymentMethodConfiguration(
    method_id: string,
    config: Record<string, any>,
  ): Observable<{ success: boolean; message?: string }> {
    return this.http
      .post<{
        success: boolean;
        message?: string;
      }>(
        `${this.api_base_url}/payment-methods/${method_id}/test`,
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
