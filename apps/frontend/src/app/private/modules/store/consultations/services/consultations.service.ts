import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { ConsultationBooking, ConsultationContext, ConsultationNote } from '../interfaces/consultation.interface';

@Injectable({ providedIn: 'root' })
export class ConsultationsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/store/consultations`;

  getToday(date?: string): Observable<ConsultationBooking[]> {
    const params: any = {};
    if (date) params.date = date;
    return this.http.get<any>(this.apiUrl, { params }).pipe(map(r => r.data));
  }

  getContext(bookingId: number): Observable<ConsultationContext> {
    return this.http.get<any>(`${this.apiUrl}/${bookingId}`).pipe(map(r => r.data));
  }

  saveNotes(bookingId: number, notes: ConsultationNote[]): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${bookingId}/notes`, { notes });
  }

  saveResponses(bookingId: number, responses: any[]): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${bookingId}/responses`, { responses });
  }

  checkIn(bookingId: number): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${bookingId}/check-in`, {});
  }

  start(bookingId: number): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${bookingId}/start`, {});
  }

  complete(bookingId: number): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${bookingId}/complete`, {});
  }
}
