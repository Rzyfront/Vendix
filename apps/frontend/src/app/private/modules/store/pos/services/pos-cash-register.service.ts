import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
import { signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';

export interface AIStreamEvent {
  type: 'text' | 'done' | 'error';
  content?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  error?: string;
}

export interface CashRegister {
  id: number;
  name: string;
  code: string;
  description?: string;
  is_active: boolean;
  default_opening_amount?: number;
  /**
   * Override opcional de bodega. Si es null, la caja hereda
   * stores.default_location_id al momento de descontar stock.
   */
  location_id?: number | null;
  location?: { id: number; name: string } | null;
  sessions?: CashRegisterSession[];
}

export interface CashRegisterSession {
  id: number;
  cash_register_id: number;
  store_id: number;
  opened_by: number;
  closed_by?: number;
  status: 'open' | 'closed' | 'suspended';
  opened_at: string;
  closed_at?: string;
  opening_amount: number;
  expected_closing_amount?: number;
  actual_closing_amount?: number;
  difference?: number;
  closing_notes?: string;
  summary?: any;
  ai_summary?: string;
  register?: CashRegister;
  opened_by_user?: { id: number; first_name: string; last_name: string };
  closed_by_user?: { id: number; first_name: string; last_name: string };
}

export interface CashRegisterMovement {
  id: number;
  session_id: number;
  type: string;
  amount: number;
  payment_method?: string;
  reference?: string;
  order_id?: number;
  notes?: string;
  created_at: string;
  user?: { id: number; first_name: string; last_name: string };
  order?: { id: number; order_number: string };
}

/**
 * Centralized service for cash register operations.
 * Replaces direct localStorage access for register_id when the feature is enabled.
 */
@Injectable({
  providedIn: 'root',
})
export class PosCashRegisterService {
  private readonly baseUrl = `${environment.apiUrl}/store/cash-registers`;
  readonly activeSession = signal<CashRegisterSession | null>(null);
  readonly activeSession$ = toObservable(this.activeSession);
  private featureEnabled = false;

  constructor(private http: HttpClient) {}

  /** Whether the cash register feature is enabled */
  get isEnabled(): boolean {
    return this.featureEnabled;
  }

  /** Set the feature flag from store settings */
  setFeatureEnabled(enabled: boolean): void {
    this.featureEnabled = enabled;
  }

  /** Get observable of the active session */
  getActiveSession$(): Observable<CashRegisterSession | null> {
    return this.activeSession$;
  }

  /** Get the current active session value */
  getActiveSessionSnapshot(): CashRegisterSession | null {
    return this.activeSession();
  }

  /**
   * Get the register_id to use in POS payments.
   * When feature enabled: returns session's register code.
   * When feature disabled: falls back to localStorage.
   */
  getRegisterId(): string | null {
    if (this.featureEnabled) {
      const session = this.activeSession();
      return session?.register?.code || null;
    }
    return localStorage.getItem('pos_register_id');
  }

  /** Check if the user has an active session (for sales validation) */
  hasActiveSession(): boolean {
    if (!this.featureEnabled) return true; // No validation when disabled
    return this.activeSession() !== null;
  }

  // --- API calls ---

  /** Fetch all cash registers */
  getCashRegisters(): Observable<CashRegister[]> {
    return this.http.get<any>(this.baseUrl).pipe(
      map((res) => res.data || []),
    );
  }

  /** Fetch the user's active session from backend */
  fetchActiveSession(): Observable<CashRegisterSession | null> {
    return this.http
      .get<any>(`${this.baseUrl}/sessions/active`)
      .pipe(
        map((res) => res.data || null),
        tap((session) => {
          if (session) {
            this.activeSession.set(session);
          }
        }),
        catchError(() => of(null)),
      );
  }

  /** Open a new session */
  openSession(cash_register_id: number, opening_amount: number): Observable<CashRegisterSession> {
    return this.http
      .post<any>(`${this.baseUrl}/sessions/open`, {
        cash_register_id,
        opening_amount,
      })
      .pipe(
        map((res) => res.data),
        tap((session) => this.activeSession.set(session)),
      );
  }

  /** Close the active session */
  closeSession(session_id: number, actual_closing_amount: number, closing_notes?: string): Observable<CashRegisterSession> {
    return this.http
      .post<any>(`${this.baseUrl}/sessions/${session_id}/close`, {
        actual_closing_amount,
        closing_notes,
      })
      .pipe(
        map((res) => res.data),
        tap(() => this.activeSession.set(null)),
      );
  }

  /** Suspend the active session */
  suspendSession(session_id: number): Observable<any> {
    return this.http
      .post<any>(`${this.baseUrl}/sessions/${session_id}/suspend`, {})
      .pipe(
        map((res) => res.data),
        tap(() => this.activeSession.set(null)),
      );
  }

  /** Get session history */
  getSessionHistory(params?: any): Observable<{ data: CashRegisterSession[]; meta: any }> {
    return this.http
      .get<any>(`${this.baseUrl}/sessions`, { params })
      .pipe(map((res) => ({ data: res.data || [], meta: res.meta || {} })));
  }

  /** Get session detail with movements */
  getSessionDetail(session_id: number): Observable<CashRegisterSession> {
    return this.http
      .get<any>(`${this.baseUrl}/sessions/${session_id}`)
      .pipe(map((res) => res.data));
  }

  /** Get session report */
  getSessionReport(session_id: number): Observable<any> {
    return this.http
      .get<any>(`${this.baseUrl}/sessions/${session_id}/report`)
      .pipe(map((res) => res.data));
  }

  /** Add manual cash movement (cash_in / cash_out) */
  addMovement(session_id: number, data: { type: 'cash_in' | 'cash_out'; amount: number; reference?: string; notes?: string }): Observable<CashRegisterMovement> {
    return this.http
      .post<any>(`${this.baseUrl}/sessions/${session_id}/movements`, data)
      .pipe(map((res) => res.data));
  }

  /** Get movements for a session */
  getMovements(session_id: number): Observable<CashRegisterMovement[]> {
    return this.http
      .get<any>(`${this.baseUrl}/sessions/${session_id}/movements`)
      .pipe(map((res) => res.data || []));
  }

  // --- CRUD for cash registers ---

  createRegister(data: Partial<CashRegister>): Observable<CashRegister> {
    return this.http.post<any>(this.baseUrl, data).pipe(map((res) => res.data));
  }

  updateRegister(id: number, data: Partial<CashRegister>): Observable<CashRegister> {
    return this.http.put<any>(`${this.baseUrl}/${id}`, data).pipe(map((res) => res.data));
  }

  deleteRegister(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/${id}`).pipe(map((res) => res.data));
  }

  /** Stream AI closing summary via SSE */
  streamClosingSummary(sessionId: number): Observable<AIStreamEvent> {
    return new Observable<AIStreamEvent>((subscriber) => {
      const token = this.getAccessToken();
      const params = new URLSearchParams();
      if (token) params.set('token', token);

      const url = `${this.baseUrl}/sessions/${sessionId}/ai-summary?${params.toString()}`;
      const eventSource = new EventSource(url);

      eventSource.addEventListener('ai-chunk', (event: MessageEvent) => {
        try {
          const data: AIStreamEvent = JSON.parse(event.data);
          subscriber.next(data);
          if (data.type === 'done' || data.type === 'error') {
            eventSource.close();
            subscriber.complete();
          }
        } catch {
          subscriber.next({ type: 'error', error: 'Failed to parse stream data' });
          eventSource.close();
          subscriber.complete();
        }
      });

      eventSource.onerror = () => {
        subscriber.next({ type: 'error', error: 'Stream connection lost' });
        eventSource.close();
        subscriber.complete();
      };

      return () => eventSource.close();
    });
  }

  /** Clear cached session (on logout or feature disable) */
  clearSession(): void {
    this.activeSession.set(null);
  }

  /** Helper: get access token from vendix_auth_state */
  private getAccessToken(): string | null {
    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (!authState) return null;
      const parsed = JSON.parse(authState);
      return parsed.tokens?.access_token || null;
    } catch {
      return null;
    }
  }
}
