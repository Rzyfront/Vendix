import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { DataCollectionSubmission } from '../interfaces/data-collection-submission.interface';

@Injectable({ providedIn: 'root' })
export class DataCollectionSubmissionsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/store/data-collection/submissions`;

  getAll(status?: string): Observable<DataCollectionSubmission[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    return this.http.get<any>(this.apiUrl, { params }).pipe(map(r => r.data));
  }

  getOne(id: number): Observable<DataCollectionSubmission> {
    return this.http.get<any>(`${this.apiUrl}/${id}`).pipe(map(r => r.data));
  }

  getByBooking(bookingId: number): Observable<DataCollectionSubmission> {
    return this.http.get<any>(`${this.apiUrl}/booking/${bookingId}`).pipe(map(r => r.data));
  }

  create(data: { template_id: number; booking_id?: number; customer_id?: number }): Observable<DataCollectionSubmission> {
    return this.http.post<any>(this.apiUrl, data).pipe(map(r => r.data));
  }

  // Public endpoints (for ecommerce form)
  getByToken(token: string): Observable<DataCollectionSubmission> {
    return this.http.get<any>(`${environment.apiUrl}/ecommerce/data-collection/${token}`).pipe(map(r => r.data));
  }

  saveStep(token: string, stepIndex: number, responses: any[]): Observable<any> {
    return this.http.post<any>(`${environment.apiUrl}/ecommerce/data-collection/${token}/step/${stepIndex}`, { responses }).pipe(map(r => r.data));
  }

  submitFinal(token: string): Observable<any> {
    return this.http.post<any>(`${environment.apiUrl}/ecommerce/data-collection/${token}/submit`, {}).pipe(map(r => r.data));
  }

  getPresignedUrl(key: string): Observable<{ url: string }> {
    const params = new HttpParams().set('key', key);
    return this.http.get<{ url: string }>(`${environment.apiUrl}/upload/presigned-url`, { params });
  }
}
