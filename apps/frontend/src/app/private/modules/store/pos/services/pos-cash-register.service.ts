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
 * Resumen autoritativo de efectivo de una sesión de caja (QUI-572).
 *
 * El backend es el ÚNICO dueño de la fórmula del efectivo esperado
 * (`expected_cash_total`); el cliente la consume, nunca la recalcula. Antes el
 * modal de cierre replicaba la aritmética sobre `getMovements()`, así que
 * cualquier divergencia entre las dos implementaciones se convertía en un
 * faltante o sobrante fantasma en el arqueo.
 *
 * Los nombres son snake_case porque es el envelope crudo del backend.
 */
export interface CashSessionSummary {
  opening: number;
  /** Todas las ventas de la sesión, sin importar el método de pago. */
  sales_total: number;
  sales_count: number;
  /** `cash` primero, el resto alfabético. Sin etiquetas: las pone el frontend. */
  sales_by_method: { method: string; count: number; total: number }[];
  cash_sales: number;
  cash_in: number;
  cash_out: number;
  cash_refunds: number;
  /** El número que gobierna el arqueo. */
  expected_cash_total: number;
  non_cash_total: number;
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
      return session?.status === 'open' ? session.register?.code || null : null;
    }
    return localStorage.getItem('pos_register_id');
  }

  /** Check if the user has an active session (for sales validation) */
  hasActiveSession(): boolean {
    if (!this.featureEnabled) return true; // No validation when disabled
    return this.activeSession()?.status === 'open';
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
        tap((session) => this.activeSession.set(session)),
        catchError(() => {
          this.activeSession.set(null);
          return of(null);
        }),
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

  /**
   * Close a session by id.
   *
   * QUI-560: el panel admin cierra sesiones de OTROS operadores desde
   * `/admin/cash-registers`, así que el signal local solo se limpia cuando la
   * sesión cerrada es la que este servicio está rastreando. Limpiarlo siempre
   * borraría la sesión activa del POS del usuario actual al cerrar una ajena.
   *
   * QUI-572: `expected_closing_amount_seen` declara el efectivo esperado que el
   * operario tenía EN PANTALLA cuando contó. Si el backend recalcula y ya no
   * coincide, rechaza el cierre con 409 `CASH_SESSION_EXPECTED_STALE_001` en vez
   * de registrar un faltante inexistente. Es opcional para no romper a los
   * llamadores que no participan del arqueo asistido.
   *
   * El error viaja CRUDO a propósito: sin `catchError` que lo aplaste, para que
   * el componente pueda ramificar por `error_code` con `extractApiError`.
   */
  closeSession(
    session_id: number,
    actual_closing_amount: number,
    closing_notes?: string,
    expected_closing_amount_seen?: number,
  ): Observable<CashRegisterSession> {
    const body: Record<string, unknown> = {
      actual_closing_amount,
      closing_notes,
    };
    if (expected_closing_amount_seen != null) {
      body['expected_closing_amount_seen'] = expected_closing_amount_seen;
    }

    return this.http
      .post<any>(`${this.baseUrl}/sessions/${session_id}/close`, body)
      .pipe(
        map((res) => res.data),
        tap(() => {
          if (this.activeSession()?.id === session_id) {
            this.activeSession.set(null);
          }
        }),
      );
  }

  /**
   * Resumen de efectivo autoritativo de la sesión (QUI-572).
   *
   * Fuente única del `expected_cash_total` que gobierna el arqueo. El error
   * viaja crudo; quien haga polling decide si lo ignora.
   */
  getCashSummary(session_id: number): Observable<CashSessionSummary> {
    return this.http
      .get<any>(`${this.baseUrl}/sessions/${session_id}/cash-summary`)
      .pipe(map((res) => res.data));
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
