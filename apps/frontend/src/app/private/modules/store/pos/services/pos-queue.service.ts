import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
import { signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';

export interface QueueEntry {
  id: number;
  store_id: number;
  token: string;
  first_name: string;
  last_name: string;
  document_type: string;
  document_number: string;
  email?: string;
  phone?: string;
  status: 'waiting' | 'selected' | 'consumed' | 'expired' | 'cancelled';
  position: number;
  selected_by?: number;
  created_at: string;
}

@Injectable({
  providedIn: 'root',
})
export class PosQueueService {
  private readonly apiUrl = `${environment.apiUrl}/store/customer-queue`;
  readonly queue = signal<QueueEntry[]>([]);
  readonly queueCount = signal<number>(0);

  readonly queue$ = toObservable(this.queue);
  readonly queueCount$ = toObservable(this.queueCount);

  constructor(private http: HttpClient) {}

  get queueEntries(): Observable<QueueEntry[]> {
    return this.queue$;
  }

  get waitingCount(): Observable<number> {
    return this.queueCount$;
  }

  loadQueue(): Observable<QueueEntry[]> {
    return this.http.get<any>(this.apiUrl).pipe(
      map((res) => res.data || []),
      tap((entries) => {
        this.queue.set(entries);
        this.queueCount.set(entries.filter((e: QueueEntry) => e.status === 'waiting').length);
      }),
      catchError(() => {
        this.queue.set([]);
        this.queueCount.set(0);
        return of([]);
      }),
    );
  }

  selectEntry(id: number): Observable<QueueEntry> {
    return this.http.post<any>(`${this.apiUrl}/${id}/select`, {}).pipe(
      map((res) => res.data),
      tap(() => this.loadQueue().subscribe()),
    );
  }

  releaseEntry(id: number): Observable<void> {
    return this.http.post<any>(`${this.apiUrl}/${id}/release`, {}).pipe(
      map(() => void 0),
      tap(() => this.loadQueue().subscribe()),
    );
  }

  consumeEntry(id: number, orderId: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${id}/consume`, { order_id: orderId }).pipe(
      map((res) => res.data),
      tap(() => this.loadQueue().subscribe()),
    );
  }

  cancelEntry(id: number): Observable<void> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`).pipe(
      map(() => void 0),
      tap(() => this.loadQueue().subscribe()),
    );
  }

  getQrCode(): Observable<{ qr_data_url: string; url: string }> {
    return this.http.get<any>(`${this.apiUrl}/qr`).pipe(
      map((res) => res.data),
    );
  }

  /** Call this when an SSE notification of type customer_queue_* arrives */
  handleQueueNotification(): void {
    this.loadQueue().subscribe();
  }
}
