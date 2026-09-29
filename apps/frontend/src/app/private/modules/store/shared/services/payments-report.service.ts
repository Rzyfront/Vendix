import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  PaymentsListResponse,
  PaymentsReportQuery,
  PaymentsSummary,
  PaymentsTrendPoint,
  StorePaymentMethodOption,
} from '../interfaces/payments-report.interface';

interface DataEnvelope<T> {
  success?: boolean;
  data: T;
}

interface StorePaymentMethodDto {
  id: number;
  display_name?: string | null;
  system_payment_method?: { display_name?: string | null } | null;
}

/**
 * Cliente HTTP de pagos (`/store/analytics/payments`). Lo consumen el reporte
 * y las vistas analíticas. SIN caché: datos vivos de lista y la llave de caché
 * tendría que llevar el scope de tienda.
 */
@Injectable({ providedIn: 'root' })
export class PaymentsReportService {
  private readonly http = inject(HttpClient);

  private url(endpoint = ''): string {
    const base = `${environment.apiUrl}/store/analytics/payments`;
    return endpoint ? `${base}/${endpoint}` : base;
  }

  /**
   * - `date_preset` se envía siempre; `date_from/date_to` solo con `custom`.
   * - Arrays -> CSV (`a,b`); vacíos, `null`, `undefined` y '' se omiten.
   */
  private buildParams(query: PaymentsReportQuery): HttpParams {
    let params = new HttpParams();
    const set = (key: string, value: string | number | undefined): void => {
      if (value === undefined || value === null || value === '') return;
      params = params.set(key, String(value));
    };

    if (query.date_preset) {
      set('date_preset', query.date_preset);
    }
    if (!query.date_preset || query.date_preset === 'custom') {
      if (query.date_from && query.date_to) {
        set('date_from', query.date_from);
        set('date_to', query.date_to);
      }
    }
    set('granularity', query.granularity);
    set('page', query.page);
    set('limit', query.limit);
    if (query.state?.length) set('state', query.state.join(','));
    if (query.payment_method_id?.length) {
      set('payment_method_id', query.payment_method_id.join(','));
    }
    set('search', query.search?.trim());
    set('sort_by', query.sort_by);
    set('sort_order', query.sort_order);
    return params;
  }

  getPayments(query: PaymentsReportQuery): Observable<PaymentsListResponse> {
    return this.http.get<PaymentsListResponse>(this.url(), {
      params: this.buildParams(query),
    });
  }

  getSummary(query: PaymentsReportQuery): Observable<PaymentsSummary> {
    return this.http
      .get<DataEnvelope<PaymentsSummary>>(this.url('summary'), {
        params: this.buildParams(query),
      })
      .pipe(map((res) => res.data));
  }

  getTrends(query: PaymentsReportQuery): Observable<PaymentsTrendPoint[]> {
    return this.http
      .get<DataEnvelope<PaymentsTrendPoint[]>>(this.url('trends'), {
        params: this.buildParams(query),
      })
      .pipe(map((res) => res.data ?? []));
  }

  exportPayments(query: PaymentsReportQuery): Observable<Blob> {
    return this.http.get(this.url('export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  /** Métodos de pago de la tienda para el filtro multi-select. */
  getStorePaymentMethods(): Observable<StorePaymentMethodOption[]> {
    return this.http
      .get<DataEnvelope<StorePaymentMethodDto[] | null>>(
        `${environment.apiUrl}/store/orders/payment-methods`,
      )
      .pipe(
        map((res) =>
          (res.data ?? []).map((m) => ({
            id: m.id,
            label:
              m.display_name ||
              m.system_payment_method?.display_name ||
              `Método ${m.id}`,
          })),
        ),
      );
  }
}
