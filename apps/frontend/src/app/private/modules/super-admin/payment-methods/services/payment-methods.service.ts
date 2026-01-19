import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  catchError,
  map,
  throwError,
  BehaviorSubject,
  finalize,
} from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  PaymentMethod,
  PaymentMethodStats,
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
  PaymentMethodQueryDto,
  PaymentMethodsPaginatedResponse,
} from '../interfaces/payment-method.interface';

@Injectable({
  providedIn: 'root',
})
export class SuperAdminPaymentMethodsService {
  private readonly apiBaseUrl = `${environment.apiUrl}/admin/payment-methods`;
  private isCreatingPaymentMethod$ = new BehaviorSubject<boolean>(false);
  private isUpdatingPaymentMethod$ = new BehaviorSubject<boolean>(false);

  constructor(private http: HttpClient) { }

  get isCreatingPaymentMethod() {
    return this.isCreatingPaymentMethod$.asObservable();
  }

  get isUpdatingPaymentMethod() {
    return this.isUpdatingPaymentMethod$.asObservable();
  }

  getPaymentMethods(
    query?: PaymentMethodQueryDto,
  ): Observable<PaymentMethod[]> {
    let params = new HttpParams();
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params = params.set(key, value.toString());
        }
      });
    }

    return this.http.get<any>(this.apiBaseUrl, { params }).pipe(
      map((response) => {
        // Handle direct array response from backend
        if (Array.isArray(response)) {
          return response;
        }
        if (response.success && response.data) {
          return response.data;
        }
        return response || [];
      }),
      catchError(this.handleError),
    );
  }

  getPaymentMethod(id: number): Observable<PaymentMethod> {
    return this.http.get<any>(`${this.apiBaseUrl}/${id}`).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
    );
  }

  createPaymentMethod(data: CreatePaymentMethodDto): Observable<PaymentMethod> {
    this.isCreatingPaymentMethod$.next(true);
    return this.http.post<any>(this.apiBaseUrl, data).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
      finalize(() => this.isCreatingPaymentMethod$.next(false)),
    );
  }

  updatePaymentMethod(
    id: number,
    data: UpdatePaymentMethodDto,
  ): Observable<PaymentMethod> {
    this.isUpdatingPaymentMethod$.next(true);
    return this.http.patch<any>(`${this.apiBaseUrl}/${id}`, data).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
      finalize(() => this.isUpdatingPaymentMethod$.next(false)),
    );
  }

  togglePaymentMethod(id: number): Observable<PaymentMethod> {
    return this.http.patch<any>(`${this.apiBaseUrl}/${id}/toggle`, {}).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
    );
  }

  deletePaymentMethod(id: number): Observable<void> {
    return this.http.delete<any>(`${this.apiBaseUrl}/${id}`).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
    );
  }

  getPaymentMethodsStats(): Observable<PaymentMethodStats> {
    return this.http.get<any>(`${this.apiBaseUrl}/stats`).pipe(
      map((response) => {
        if (response.success && response.data) {
          return response.data;
        }
        return response;
      }),
      catchError(this.handleError),
    );
  }

  getPaymentMethodIcon(type: string): string {
    const iconMap: Record<string, string> = {
      cash: 'dollar-sign',
      card: 'credit-card',
      paypal: 'globe',
      bank_transfer: 'building',
      voucher: 'ticket',
    };
    return iconMap[type] || 'credit-card';
  }

  getPaymentMethodTypeLabel(type: string): string {
    const labelMap: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      paypal: 'PayPal',
      bank_transfer: 'Transferencia',
      voucher: 'Voucher',
    };
    return labelMap[type] || type;
  }

  getPaymentMethodProviderLabel(provider: string): string {
    const providerMap: Record<string, string> = {
      stripe: 'Stripe',
      paypal: 'PayPal',
      mercadopago: 'Mercado Pago',
      manual: 'Manual',
      custom: 'Personalizado',
    };
    return providerMap[provider] || provider;
  }

  private handleError(error: any): Observable<never> {
    let errorMessage = 'An unknown error occurred';

    if (error.error instanceof ErrorEvent) {
      errorMessage = error.error.message;
    } else if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }

    console.error('SuperAdminPaymentMethodsService error:', error);
    return throwError(() => new Error(errorMessage));
  }
}
