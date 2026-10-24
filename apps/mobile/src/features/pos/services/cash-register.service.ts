import { apiClient, Endpoints } from '@/core/api';

/**
 * Servicio de caja registradora — paridad con `pos-cash-register.service.ts` web.
 *
 * Endpoints (todos bajo `/store/cash-registers`):
 *  - LIST                    → listar cajas registradas
 *  - SESSION_ACTIVE          → sesión abierta del usuario actual
 *  - SESSION_OPEN            → POST abrir nueva sesión
 *  - SESSION_DETAIL/:id      → detalle de una sesión
 *  - SESSION_CLOSE/:id       → POST cerrar sesión
 *  - SESSION_SUSPEND/:id     → POST suspender sesión
 *  - SESSION_REPORT/:id      → reporte consolidado
 *  - SESSION_MOVEMENTS/:id   → GET/POST movimientos de caja (cash_in/cash_out)
 *
 * El backend envuelve cada respuesta con `{ success, data, message }`. La
 * función `unwrap` extrae `data` para mantener la firma simple.
 */

export interface CashRegister {
  id: number;
  name: string;
  code: string;
  description?: string;
  is_active: boolean;
  default_opening_amount?: number;
  location_id?: number | null;
  location?: { id: number; name: string } | null;
  sessions?: CashRegisterSession[];
}

export type CashSessionStatus = 'open' | 'closed' | 'suspended';

export interface CashRegisterSession {
  id: number;
  cash_register_id: number;
  store_id: number;
  opened_by: number;
  closed_by?: number;
  status: CashSessionStatus;
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

export interface CashSessionSummary {
  opening: number;
  expected_cash_total: number;
  sales_total: number;
  sales_count: number;
  sales_by_method: { method: string; count: number; total: number }[];
  cash_sales: number;
  cash_in: number;
  cash_out: number;
  cash_refunds: number;
  non_cash_total: number;
}

export interface CashSessionPendingOrder {
  id: number;
  order_number: string;
  state: string;
  remaining_balance: number;
  reasons: ('operational' | 'balance')[];
  version: string | null;
  fingerprint: string;
}

export interface CashSessionPendingOrders {
  tracking_enabled: boolean;
  legacy_unattributed: { status: 'untracked'; message: string } | null;
  count: number;
  operational_count: number;
  balance_count: number;
  balance_total: number;
  fingerprint: string;
  page: number;
  limit: number;
  data: CashSessionPendingOrder[];
}

export interface CashSessionFinishPreview {
  session_id: number;
  total: number;
  eligible: number;
  ineligible: number;
  fingerprint: string;
  eligible_fingerprint: string;
  items: {
    id: number;
    order_number: string;
    current_state: string;
    target_state: 'finished';
    eligible: boolean;
    reasons: string[];
    effects: string[];
    version: string | null;
    fingerprint: string;
  }[];
}

export interface CashSessionCloseDecision {
  pending_decision: 'resolved' | 'override';
  pending_fingerprint: string;
  override_reason?: string;
}

function unwrap<T>(response: { data: T | { data: T } }): T {
  const d = response.data as { data?: T };
  if (d && typeof d === 'object' && 'data' in d && d.data !== undefined) {
    return d.data as T;
  }
  return response.data as T;
}

export const CashRegisterService = {
  /** Lista todas las cajas registradoras. */
  async listRegisters(): Promise<CashRegister[]> {
    const res = await apiClient.get(Endpoints.STORE.CASH_REGISTERS.LIST);
    return unwrap<CashRegister[]>(res);
  },

  /** Sesión activa del usuario actual (o null). */
  async getActiveSession(): Promise<CashRegisterSession | null> {
    try {
      const res = await apiClient.get(Endpoints.STORE.CASH_REGISTERS.SESSION_ACTIVE);
      return unwrap<CashRegisterSession>(res);
    } catch {
      // 404 = sin sesión activa — no es un error.
      return null;
    }
  },

  /** Detalle de una sesión específica (incluye summary + ai_summary). */
  async getSession(sessionId: number): Promise<CashRegisterSession> {
    const endpoint = Endpoints.STORE.CASH_REGISTERS.SESSION_DETAIL.replace(':id', String(sessionId));
    const res = await apiClient.get(endpoint);
    return unwrap<CashRegisterSession>(res);
  },

  /** Abre una nueva sesión en una caja con monto inicial. */
  async openSession(cashRegisterId: number, openingAmount: number): Promise<CashRegisterSession> {
    const res = await apiClient.post(Endpoints.STORE.CASH_REGISTERS.SESSION_OPEN, {
      cash_register_id: cashRegisterId,
      opening_amount: openingAmount,
    });
    return unwrap<CashRegisterSession>(res);
  },

  /** Cierra la sesión activa con monto real contado y notas. */
  async closeSession(
    sessionId: number,
    actualClosingAmount: number,
    closingNotes?: string,
    expectedClosingAmountSeen?: number,
    pendingDecision?: CashSessionCloseDecision,
  ): Promise<CashRegisterSession> {
    const endpoint = Endpoints.STORE.CASH_REGISTERS.SESSION_CLOSE.replace(':id', String(sessionId));
    const res = await apiClient.post(endpoint, {
      actual_closing_amount: actualClosingAmount,
      closing_notes: closingNotes,
      ...(expectedClosingAmountSeen != null
        ? { expected_closing_amount_seen: expectedClosingAmountSeen }
        : {}),
      ...(pendingDecision ?? {}),
    });
    return unwrap<CashRegisterSession>(res);
  },

  /** Resumen de efectivo que gobierna el cierre; incluye el esperado más fresco. */
  async getCashSummary(sessionId: number): Promise<CashSessionSummary> {
    const res = await apiClient.get(`/store/cash-registers/sessions/${sessionId}/cash-summary`);
    return unwrap<CashSessionSummary>(res);
  },

  /** Lista y huella global de las órdenes originadas en esta sesión. */
  async getPendingOrders(
    sessionId: number,
    page = 1,
    limit = 10,
  ): Promise<CashSessionPendingOrders> {
    const res = await apiClient.get(
      `/store/cash-registers/sessions/${sessionId}/pending-orders`,
      { params: { page, limit } },
    );
    return unwrap<CashSessionPendingOrders>(res);
  },

  async previewCashSessionFinish(
    sessionId: number,
    orders: { id: number; version: string; fingerprint: string }[],
  ): Promise<CashSessionFinishPreview> {
    const res = await apiClient.post('/store/orders/bulk/cash-session-preview', {
      session_id: sessionId,
      orders,
    });
    return unwrap<CashSessionFinishPreview>(res);
  },

  async finishCashSessionOrders(
    sessionId: number,
    orders: { id: number; version: string; fingerprint: string }[],
    fingerprint: string,
    reason: string,
  ): Promise<unknown> {
    const res = await apiClient.post('/store/orders/bulk/cash-session-finish', {
      session_id: sessionId,
      orders,
      fingerprint,
      reason,
    });
    return unwrap<unknown>(res);
  },

  /** Suspende la sesión activa. */
  async suspendSession(sessionId: number): Promise<unknown> {
    const endpoint = Endpoints.STORE.CASH_REGISTERS.SESSION_SUSPEND.replace(':id', String(sessionId));
    const res = await apiClient.post(endpoint, {});
    return unwrap<unknown>(res);
  },

  /** Movimientos manuales (cash_in / cash_out) de una sesión. */
  async getMovements(sessionId: number): Promise<CashRegisterMovement[]> {
    const endpoint = Endpoints.STORE.CASH_REGISTERS.SESSION_MOVEMENTS.replace(':id', String(sessionId));
    const res = await apiClient.get(endpoint);
    return unwrap<CashRegisterMovement[]>(res);
  },

  /** Registra un movimiento manual (entrada o salida de efectivo). */
  async addMovement(
    sessionId: number,
    data: { type: 'cash_in' | 'cash_out'; amount: number; reference?: string; notes?: string },
  ): Promise<CashRegisterMovement> {
    const endpoint = Endpoints.STORE.CASH_REGISTERS.SESSION_MOVEMENTS.replace(':id', String(sessionId));
    const res = await apiClient.post(endpoint, data);
    return unwrap<CashRegisterMovement>(res);
  },

  /** Reporte consolidado (resumen + IA). */
  async getReport(sessionId: number): Promise<any> {
    const endpoint = Endpoints.STORE.CASH_REGISTERS.SESSION_REPORT.replace(':id', String(sessionId));
    const res = await apiClient.get(endpoint);
    return unwrap<any>(res);
  },
};
