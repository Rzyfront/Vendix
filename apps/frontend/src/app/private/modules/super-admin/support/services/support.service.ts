import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  Ticket,
  TicketStats,
  CreateTicketDto,
  UpdateTicketDto,
  TicketQueryDto,
  PaginatedTicketsResponse,
  UpdateTicketStatusDto,
  CloseTicketDto,
  AssignTicketDto,
} from '../interfaces/ticket.interface';

@Injectable({
  providedIn: 'root',
})
export class SupportService {
  private readonly API_URL = `${environment.apiUrl}/superadmin/support`;

  constructor(private http: HttpClient) {}

  getTicketStats(): Observable<TicketStats> {
    return this.http.get<any>(`${this.API_URL}/tickets/stats`).pipe(
      map((response) => response.data || response)
    );
  }

  /**
   * PQR stats for the sidebar badge. Returns the raw `stats` payload
   * shaped like { by_status, by_type, by_priority, total, recent_24h } —
   * the caller picks the counters they need (open count for the badge).
   */
  getPqrStats(): Observable<{
    total: number;
    recent_24h: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
    by_priority: Record<string, number>;
  }> {
    return this.http.get<any>(`${this.API_URL}/pqrs/stats`).pipe(
      map((response) => response.data || response),
    );
  }

  getTickets(params: TicketQueryDto): Observable<PaginatedTicketsResponse> {
    let httpParams = new HttpParams();
    if (params.page) httpParams = httpParams.set('page', params.page);
    if (params.limit) httpParams = httpParams.set('limit', params.limit);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.priority) httpParams = httpParams.set('priority', params.priority);
    if (params.category) httpParams = httpParams.set('category', params.category);
    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.organization_id) httpParams = httpParams.set('organization_id', params.organization_id);
    if (params.store_id) httpParams = httpParams.set('store_id', params.store_id);

    return this.http.get<any>(`${this.API_URL}/tickets`, { params: httpParams }).pipe(
      map((response) => ({
        data: response.data || [],
        meta: response.meta || { total: 0, page: 1, limit: 10, pages: 1 }
      }))
    );
  }

  getTicketById(id: number): Observable<Ticket> {
    return this.http.get<any>(`${this.API_URL}/tickets/${id}`).pipe(
      map((response) => response.data || response)
    );
  }

  createTicket(request: CreateTicketDto): Observable<Ticket> {
    return this.http.post<any>(`${this.API_URL}/tickets`, request).pipe(
      map((response) => response.data || response)
    );
  }

  updateTicket(id: number, request: UpdateTicketDto): Observable<Ticket> {
    return this.http.patch<any>(`${this.API_URL}/tickets/${id}`, request).pipe(
      map((response) => response.data || response)
    );
  }

  updateTicketStatus(id: number, request: UpdateTicketStatusDto): Observable<Ticket> {
    return this.http.patch<any>(`${this.API_URL}/tickets/${id}/status`, request).pipe(
      map((response) => response.data || response)
    );
  }

  assignTicket(id: number, request: AssignTicketDto): Observable<Ticket> {
    return this.http.patch<any>(`${this.API_URL}/tickets/${id}/assign`, request).pipe(
      map((response) => response.data || response)
    );
  }

  closeTicket(id: number, request: CloseTicketDto): Observable<Ticket> {
    return this.http.patch<any>(`${this.API_URL}/tickets/${id}/close`, request).pipe(
      map((response) => response.data || response)
    );
  }

  reopenTicket(id: number): Observable<Ticket> {
    return this.http.patch<any>(`${this.API_URL}/tickets/${id}/reopen`, {}).pipe(
      map((response) => response.data || response)
    );
  }

  deleteTicket(id: number): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/tickets/${id}`);
  }

  // Comments
  getComments(ticketId: number): Observable<any[]> {
    return this.http.get<any>(`${this.API_URL}/tickets/${ticketId}/comments`).pipe(
      map((response) => response.data || [])
    );
  }

  addComment(ticketId: number, content: string, isInternal: boolean = false): Observable<any> {
    return this.http.post<any>(`${this.API_URL}/tickets/${ticketId}/comments`, {
      content,
      is_internal: isInternal,
    }).pipe(
      map((response) => response.data || response)
    );
  }

  // ─── PQR actions ──────────────────────────────────────────────────────
  // The super-admin is the actual recipient of platform-wide PQRs (they
  // land at admin@vendix.online), so this controller exposes the same
  // write surface as the store-admin one — comments, status changes,
  // and assignments — just on the superadmin/support/pqrs path.

  addPqrComment(
    pqrId: number,
    content: string,
    isInternal: boolean = false,
    notifyRequester: boolean = true,
  ): Observable<any> {
    return this.http
      .post<any>(`${this.API_URL}/pqrs/${pqrId}/comments`, {
        content,
        is_internal: isInternal,
        notify_requester: notifyRequester,
      })
      .pipe(map((response) => response.data || response));
  }

  updatePqrStatus(
    pqrId: number,
    payload: { status: string; change_reason?: string; resolution_summary?: string },
  ): Observable<any> {
    return this.http
      .patch<any>(`${this.API_URL}/pqrs/${pqrId}/status`, payload)
      .pipe(map((response) => response.data || response));
  }

  assignPqr(
    pqrId: number,
    assignedToUserId: number | null,
    notes?: string,
  ): Observable<any> {
    return this.http
      .patch<any>(`${this.API_URL}/pqrs/${pqrId}/assign`, {
        assigned_to_user_id: assignedToUserId,
        notes,
      })
      .pipe(map((response) => response.data || response));
  }
}
