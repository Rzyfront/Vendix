import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, delay, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  PaymentMethod,
  PaymentMethodType,
  fromPosBackendMethod,
} from '../models/payment-method.model';

/**
 * Shared, context-aware catalog of the payment methods a store can charge with.
 *
 * It calls the SAME endpoint the POS uses to collect payments
 * (`GET /store/payments/payment-methods`, which relies on the caller's token
 * scope) and maps the response to the canonical {@link PaymentMethod} shape via
 * {@link fromPosBackendMethod}. This is the single source of truth for the
 * upcoming shared checkout component (Phase 3); `PosPaymentService` now delegates
 * to it.
 *
 * NOTE: this is the *charging* catalog, not the settings/CRUD endpoint
 * (`GET /store/payment-methods`), which stays owned by `PaymentMethodsService`.
 */
@Injectable({ providedIn: 'root' })
export class PaymentMethodsCatalogService {
  private readonly http = inject(HttpClient);
  private readonly paymentMethodsUrl = `${environment.apiUrl}/store/payments/payment-methods`;

  /**
   * Corrected local fallback with the base methods (cash / card / bank_transfer)
   * previously hardcoded in `PosPaymentService.PAYMENT_METHODS`. Legacy
   * `transfer` / `digital_wallet` types were normalized to the canonical enum.
   */
  private readonly FALLBACK_METHODS: PaymentMethod[] = [
    {
      id: 'cash',
      name: 'Efectivo',
      type: PaymentMethodType.CASH,
      icon: 'cash',
      enabled: true,
    },
    {
      id: 'card',
      name: 'Tarjeta de Crédito/Débito',
      type: PaymentMethodType.CARD,
      icon: 'credit-card',
      enabled: true,
      requiresReference: true,
      referenceLabel: 'Últimos 4 dígitos',
    },
    {
      id: 'bank_transfer',
      name: 'Transferencia Bancaria',
      type: PaymentMethodType.BANK_TRANSFER,
      icon: 'bank',
      enabled: true,
      requiresReference: true,
      referenceLabel: 'Número de referencia',
    },
  ];

  /**
   * Return the store's configured payment methods (each carrying an `enabled`
   * flag), mapped to the canonical shape. Preserves the legacy POS loader
   * semantics: the backend array is mapped as-is (not filtered), and only the
   * local fallback is filtered by `enabled` on failure / empty response.
   */
  getEnabledMethods(): Observable<PaymentMethod[]> {
    return this.http.get<any>(this.paymentMethodsUrl).pipe(
      map((response) => {
        const methodsData = response?.data ?? response;
        if (Array.isArray(methodsData)) {
          return methodsData.map((raw) => fromPosBackendMethod(raw));
        }
        return this.FALLBACK_METHODS.filter((method) => method.enabled);
      }),
      catchError(() =>
        of(this.FALLBACK_METHODS.filter((method) => method.enabled)).pipe(
          delay(100),
        ),
      ),
    );
  }
}
