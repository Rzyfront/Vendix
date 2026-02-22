import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  Ticket,
  TicketStats,
  CreateTicketRequest,
  TicketComment,
} from '../models/ticket.model';

export interface TicketListResponse {
  data: Ticket[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface TicketQueryParams {
  page?: number;
  limit?: number;
  status?: string;
  priority?: string;
  category?: string;
  search?: string;
}

@Injectable({
  providedIn: 'root',
})
export class SupportService {
  private readonly API_URL = `${environment.apiUrl}/support`;

  constructor(private http: HttpClient) {}

  getTicketStats(): Observable<TicketStats> {
    return this.http.get<any>(`${this.API_URL}/tickets/stats`).pipe(
      map((response) => response.data || response)
    );
  }

  getTickets(params: TicketQueryParams): Observable<TicketListResponse> {
    let httpParams = new HttpParams();
    if (params.page) httpParams = httpParams.set('page', params.page);
    if (params.limit) httpParams = httpParams.set('limit', params.limit);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.priority) httpParams = httpParams.set('priority', params.priority);
    if (params.category) httpParams = httpParams.set('category', params.category);
    if (params.search) httpParams = httpParams.set('search', params.search);

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

  createTicket(request: CreateTicketRequest): Observable<Ticket> {
    return this.http.post<any>(`${this.API_URL}/tickets`, request).pipe(
      map((response) => response.data || response)
    );
  }

  updateTicket(id: number, request: Partial<CreateTicketRequest>): Observable<Ticket> {
    return this.http.patch<any>(`${this.API_URL}/tickets/${id}`, request).pipe(
      map((response) => response.data || response)
    );
  }

  updateTicketStatus(id: number, status: string, reason?: string): Observable<Ticket> {
    return this.http.patch<any>(`${this.API_URL}/tickets/${id}/status`, {
      status,
      reason,
    }).pipe(
      map((response) => response.data || response)
    );
  }

  assignTicket(id: number, assignedToUserId: number): Observable<Ticket> {
    return this.http.patch<any>(`${this.API_URL}/tickets/${id}/assign`, {
      assigned_to_user_id: assignedToUserId,
    }).pipe(
      map((response) => response.data || response)
    );
  }

  closeTicket(id: number, resolutionSummary?: string, customerSatisfied?: boolean): Observable<Ticket> {
    return this.http.patch<any>(`${this.API_URL}/tickets/${id}/close`, {
      resolution_summary: resolutionSummary,
      customer_satisfied: customerSatisfied,
    }).pipe(
      map((response) => response.data || response)
    );
  }

  reopenTicket(id: number): Observable<Ticket> {
    return this.http.patch<any>(`${this.API_URL}/tickets/${id}/reopen`, {}).pipe(
      map((response) => response.data || response)
    );
  }

  getComments(ticketId: number): Observable<TicketComment[]> {
    return this.http.get<any>(`${this.API_URL}/comments/ticket/${ticketId}`).pipe(
      map((response) => response.data || [])
    );
  }

  addComment(ticketId: number, content: string, isInternal: boolean = false): Observable<TicketComment> {
    return this.http.post<any>(`${this.API_URL}/comments`, {
      ticket_id: ticketId,
      content,
      is_internal: isInternal,
    }).pipe(
      map((response) => response.data || response)
    );
  }

  deleteComment(commentId: number): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/comments/${commentId}`);
  }
}
