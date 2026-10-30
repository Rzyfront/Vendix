import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';

/** Fecha especial de la agenda de pedidos programados. */
export interface FulfillmentException {
  id: number;
  /** ISO (medianoche UTC) o `YYYY-MM-DD`: usar solo los primeros 10 caracteres. */
  date: string;
  is_closed: boolean;
  start_time: string | null;
  end_time: string | null;
  slot_capacity: number | null;
  day_capacity: number | null;
  reason: string | null;
}

export interface CreateFulfillmentException {
  date: string;
  is_closed?: boolean;
  start_time?: string;
  end_time?: string;
  slot_capacity?: number;
  day_capacity?: number;
  reason?: string;
}

/**
 * `GET|POST /store/scheduled-orders/exceptions` y
 * `DELETE /store/scheduled-orders/exceptions/:id`.
 */
@Injectable({ providedIn: 'root' })
export class ScheduledOrderExceptionsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/store/scheduled-orders/exceptions`;

  list(from?: string): Observable<FulfillmentException[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    return this.http
      .get<{ data: FulfillmentException[] }>(this.url, { params })
      .pipe(map((res) => res.data ?? []));
  }

  create(body: CreateFulfillmentException): Observable<FulfillmentException> {
    return this.http
      .post<{ data: FulfillmentException }>(this.url, body)
      .pipe(map((res) => res.data));
  }

  remove(id: number): Observable<void> {
    return this.http.delete(`${this.url}/${id}`).pipe(map(() => undefined));
  }
}
