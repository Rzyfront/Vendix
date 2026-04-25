import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, of, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface StorePaymentMethod {
  id: number;
  store_id: number;
  system_payment_method_id: number;
  display_name: string;
  custom_config: Record<string, any>;
  state: 'enabled' | 'disabled' | 'requires_configuration';
  display_order: number;
  min_amount?: number;
  max_amount?: number;
  created_at: string;
  updated_at: string;
  system_payment_method?: SystemPaymentMethod;
}

export interface SystemPaymentMethod {
  id: number;
  name: string;
  display_name: string;
  type: string;
  provider: string;
  requires_config: boolean;
  config_schema?: Record<string, any>;
  is_active: boolean;
}

export interface PaymentMethodStats {
  total_methods: number;
  enabled_methods: number;
  disabled_methods: number;
  requires_config: number;
  total_transactions: number;
  successful_transactions: number;
  failed_transactions: number;
  total_revenue: number;
}

@Injectable({ providedIn: 'root' })
export class PaymentMethodsService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/store/payment-methods`;

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  getEnabled(): Observable<StorePaymentMethod[]> {
    this.loading.set(true);
    return this.http.get<{ data: StorePaymentMethod[] }>(this.baseUrl).pipe(
      tap(() => this.loading.set(false)),
      map((response) => response?.data ?? []),
      catchError((err) => {
        this.loading.set(false);
        this.error.set('Error al cargar métodos de pago');
        return of([]);
      }),
    );
  }

  getAvailable(): Observable<SystemPaymentMethod[]> {
    return this.http.get<{ data: SystemPaymentMethod[] }>(`${this.baseUrl}/available`).pipe(
      map((response) => response?.data ?? []),
      catchError(() => of([])),
    );
  }

  getStats(): Observable<PaymentMethodStats> {
    return this.http.get<{ data: PaymentMethodStats }>(`${this.baseUrl}/stats`).pipe(
      map((response) => response?.data ?? {
        total_methods: 0,
        enabled_methods: 0,
        disabled_methods: 0,
        requires_config: 0,
        total_transactions: 0,
        successful_transactions: 0,
        failed_transactions: 0,
        total_revenue: 0,
      }),
      catchError(() => of({
        total_methods: 0,
        enabled_methods: 0,
        disabled_methods: 0,
        requires_config: 0,
        total_transactions: 0,
        successful_transactions: 0,
        failed_transactions: 0,
        total_revenue: 0,
      })),
    );
  }

  getOne(id: number): Observable<StorePaymentMethod> {
    return this.http.get<{ data: StorePaymentMethod }>(`${this.baseUrl}/${id}`).pipe(
      map((response) => response?.data as StorePaymentMethod),
      catchError(() => throwError(() => new Error('Error al obtener método de pago'))),
    );
  }

  enable(systemMethodId: number, config?: Record<string, any>, displayName?: string): Observable<StorePaymentMethod> {
    this.saving.set(true);
    return this.http.post<{ data: StorePaymentMethod }>(`${this.baseUrl}/enable/${systemMethodId}`, {
      custom_config: config,
      display_name: displayName,
    }).pipe(
      tap(() => this.saving.set(false)),
      map((response) => response?.data as StorePaymentMethod),
      catchError((err) => {
        this.saving.set(false);
        this.error.set('Error al habilitar método de pago');
        return throwError(() => err);
      }),
    );
  }

  update(id: number, updates: { display_name?: string; custom_config?: Record<string, any>; min_amount?: number; max_amount?: number }): Observable<StorePaymentMethod> {
    this.saving.set(true);
    return this.http.patch<{ data: StorePaymentMethod }>(`${this.baseUrl}/${id}`, updates).pipe(
      tap(() => this.saving.set(false)),
      map((response) => response?.data as StorePaymentMethod),
      catchError((err) => {
        this.saving.set(false);
        this.error.set('Error al actualizar método de pago');
        return throwError(() => err);
      }),
    );
  }

  disable(id: number): Observable<void> {
    this.saving.set(true);
    return this.http.patch<{ data: any }>(`${this.baseUrl}/${id}/disable`, {}).pipe(
      tap(() => this.saving.set(false)),
      map(() => undefined),
      catchError((err) => {
        this.saving.set(false);
        this.error.set('Error al deshabilitar método de pago');
        return throwError(() => err);
      }),
    );
  }

  enableMethod(id: number): Observable<void> {
    this.saving.set(true);
    return this.http.patch<{ data: any }>(`${this.baseUrl}/${id}/enable`, {}).pipe(
      tap(() => this.saving.set(false)),
      map(() => undefined),
      catchError((err) => {
        this.saving.set(false);
        this.error.set('Error al habilitar método de pago');
        return throwError(() => err);
      }),
    );
  }

  remove(id: number): Observable<void> {
    return this.http.delete<{ data: any }>(`${this.baseUrl}/${id}`).pipe(
      map(() => undefined),
      catchError((err) => {
        this.error.set('Error al eliminar método de pago');
        return throwError(() => err);
      }),
    );
  }

  reorder(methodIds: number[]): Observable<void> {
    return this.http.post<{ data: any }>(`${this.baseUrl}/reorder`, {
      methods: methodIds.map((id, index) => ({ id, order: index })),
    }).pipe(
      map(() => undefined),
      catchError(() => throwError(() => new Error('Error al reordenar'))),
    );
  }
}