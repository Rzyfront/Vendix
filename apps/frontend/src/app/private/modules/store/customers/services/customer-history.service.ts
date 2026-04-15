import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

export interface ConsultationHistoryEntry {
  id: number;
  booking_number: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  product?: { id: number; name: string };
  provider?: { id: number; display_name: string };
  has_intake_data: boolean;
  has_prediagnosis: boolean;
  notes_count: number;
  has_snapshot: boolean;
}

export interface ConsultationNote {
  id: number;
  store_id: number;
  customer_id: number;
  booking_id: number;
  note_key: string;
  note_value: string;
  include_in_summary: boolean;
  booking?: { id: number; booking_number: string; date: string; product?: { name: string } };
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class CustomerHistoryService {
  private http = inject(HttpClient);

  private getBaseUrl(customerId: number) {
    return `${environment.apiUrl}/store/customers/${customerId}/history`;
  }

  getTimeline(customerId: number, page = 1, limit = 20): Observable<{ data: ConsultationHistoryEntry[]; meta: any }> {
    let params = new HttpParams().set('page', page.toString()).set('limit', limit.toString());
    return this.http.get<any>(this.getBaseUrl(customerId), { params }).pipe(map(r => r.data));
  }

  getBookingDetail(customerId: number, bookingId: number): Observable<any> {
    return this.http.get<any>(`${this.getBaseUrl(customerId)}/${bookingId}`).pipe(map(r => r.data));
  }

  getSummaryNotes(customerId: number): Observable<ConsultationNote[]> {
    return this.http.get<any>(`${this.getBaseUrl(customerId)}/summary`).pipe(map(r => r.data));
  }

  getFullContext(customerId: number): Observable<any> {
    return this.http.get<any>(`${this.getBaseUrl(customerId)}/context`).pipe(map(r => r.data));
  }

  addNote(customerId: number, bookingId: number, noteKey: string, noteValue: string): Observable<ConsultationNote> {
    return this.http.post<any>(`${this.getBaseUrl(customerId)}/${bookingId}/notes`, {
      note_key: noteKey,
      note_value: noteValue,
    }).pipe(map(r => r.data));
  }

  toggleNoteSummary(customerId: number, noteId: number): Observable<ConsultationNote> {
    return this.http.patch<any>(`${this.getBaseUrl(customerId)}/notes/${noteId}/toggle-summary`, {}).pipe(map(r => r.data));
  }
}
