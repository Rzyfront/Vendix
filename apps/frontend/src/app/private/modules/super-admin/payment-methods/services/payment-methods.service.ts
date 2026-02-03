import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  catchError,
  map,
  throwError,
  BehaviorSubject,
  finalize,
} from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
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

  private readonly isLoading$$ = new BehaviorSubject<boolean>(false);
  private readonly isCreatingPaymentMethod$$ = new BehaviorSubject<boolean>(false);
  private readonly isUpdatingPaymentMethod$$ = new BehaviorSubject<boolean>(false);
  private readonly isDeletingPaymentMethod$$ = new BehaviorSubject<boolean>(false);

  public readonly isLoading$ = this.isLoading$$.asObservable();
  public readonly isCreatingPaymentMethod$ = this.isCreatingPaymentMethod$$.asObservable();
  public readonly isUpdatingPaymentMethod$ = this.isUpdatingPaymentMethod$$.asObservable();
  public readonly isDeletingPaymentMethod$ = this.isDeletingPaymentMethod$$.asObservable();

  getPaymentMethods(
    query?: PaymentMethodQueryDto,
  ): Observable<PaymentMethod[]> {
    this.isLoading$$.next(true);
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
      finalize(() => this.isLoading$$.next(false)),
    );
  }

  getPaymentMethod(id: number): Observable<PaymentMethod> {
    return this.http.get<any>(`${this.apiBaseUrl}/${id}`).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
    );
  }

  createPaymentMethod(data: CreatePaymentMethodDto): Observable<PaymentMethod> {
    this.isCreatingPaymentMethod$$.next(true);
    return this.http.post<any>(this.apiBaseUrl, data).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
      finalize(() => this.isCreatingPaymentMethod$$.next(false)),
    );
  }

  updatePaymentMethod(
    id: number,
    data: UpdatePaymentMethodDto,
  ): Observable<PaymentMethod> {
    this.isUpdatingPaymentMethod$$.next(true);
    return this.http.patch<any>(`${this.apiBaseUrl}/${id}`, data).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
      finalize(() => this.isUpdatingPaymentMethod$$.next(false)),
    );
  }

  togglePaymentMethod(id: number): Observable<PaymentMethod> {
    this.isUpdatingPaymentMethod$$.next(true);
    return this.http.patch<any>(`${this.apiBaseUrl}/${id}/toggle`, {}).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
      finalize(() => this.isUpdatingPaymentMethod$$.next(false)),
    );
  }

  deletePaymentMethod(id: number): Observable<void> {
    this.isDeletingPaymentMethod$$.next(true);
    return this.http.delete<any>(`${this.apiBaseUrl}/${id}`).pipe(
      map((response) => response.data || response),
      catchError(this.handleError),
      finalize(() => this.isDeletingPaymentMethod$$.next(false)),
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
