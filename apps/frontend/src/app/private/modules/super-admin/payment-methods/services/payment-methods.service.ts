import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  catchError,
  map,
  throwError,
  finalize,
} from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';
import {
  PaymentMethod,
  PaymentMethodStats,
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
  PaymentMethodQueryDto,
} from '../interfaces/payment-method.interface';

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let paymentMethodsStatsCache: CacheEntry<Observable<PaymentMethodStats>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class SuperAdminPaymentMethodsService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = `${environment.apiUrl}/admin/payment-methods`;
  private readonly CACHE_TTL = 30000; // 30 segundos

  // Signals para estado de carga — Angular 20 Zoneless
  readonly isLoading = signal(false);
  readonly isLoading$ = toObservable(this.isLoading);
  readonly isCreatingPaymentMethod = signal(false);
  readonly isCreatingPaymentMethod$ = toObservable(this.isCreatingPaymentMethod);
  readonly isUpdatingPaymentMethod = signal(false);
  readonly isUpdatingPaymentMethod$ = toObservable(this.isUpdatingPaymentMethod);
  readonly isDeletingPaymentMethod = signal(false);
  readonly isDeletingPaymentMethod$ = toObservable(this.isDeletingPaymentMethod);

  getPaymentMethods(
    query?: PaymentMethodQueryDto,
  ): Observable<PaymentMethod[]> {
    this.isLoading.set(true);
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
        if (Array.isArray(response)) {
          return response;
        }
        if (response.success && response.data) {
          return response.data;
        }
        return response || [];
      }),
      catchError(this.handleError),
      finalize(() => this.isLoading.set(false)),
    );
  }

  getPaymentMethod(id: number): Observable<PaymentMethod> {
    return this.http.get<any>(`${this.apiBaseUrl}/${id}`).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
    );
  }

  createPaymentMethod(data: CreatePaymentMethodDto): Observable<PaymentMethod> {
    this.isCreatingPaymentMethod.set(true);
    return this.http.post<any>(this.apiBaseUrl, data).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
      finalize(() => this.isCreatingPaymentMethod.set(false)),
    );
  }

  updatePaymentMethod(
    id: number,
    data: UpdatePaymentMethodDto,
  ): Observable<PaymentMethod> {
    this.isUpdatingPaymentMethod.set(true);
    return this.http.patch<any>(`${this.apiBaseUrl}/${id}`, data).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
      finalize(() => this.isUpdatingPaymentMethod.set(false)),
    );
  }

  togglePaymentMethod(id: number): Observable<PaymentMethod> {
    this.isUpdatingPaymentMethod.set(true);
    return this.http.patch<any>(`${this.apiBaseUrl}/${id}/toggle`, {}).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
      finalize(() => this.isUpdatingPaymentMethod.set(false)),
    );
  }

  deletePaymentMethod(id: number): Observable<void> {
    this.isDeletingPaymentMethod.set(true);
    return this.http.delete<any>(`${this.apiBaseUrl}/${id}`).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
      finalize(() => this.isDeletingPaymentMethod.set(false)),
    );
  }

  getPaymentMethodsStats(): Observable<PaymentMethodStats> {
    const now = Date.now();

    if (paymentMethodsStatsCache && (now - paymentMethodsStatsCache.lastFetch) < this.CACHE_TTL) {
      return paymentMethodsStatsCache.observable;
    }

    const observable$ = this.http
      .get<any>(`${this.apiBaseUrl}/stats`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        map((response) => {
          if (response.success && response.data) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError),
        tap(() => {
          if (paymentMethodsStatsCache) {
            paymentMethodsStatsCache.lastFetch = Date.now();
          }
        }),
      );

    paymentMethodsStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
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

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar métodos de pago
   */
  invalidateCache(): void {
    paymentMethodsStatsCache = null;
  }
}
