import { ErrorCodes } from 'src/common/errors';
import { SETTLED_PAYMENT_STATES } from '../order-flow/order-cancellation-policy.util';

// Validation allocates the fiscal number; DIAN rejection does not undo it.
const NUMBERED_INVOICE_STATES = new Set([
  'validated', 'sent', 'accepted', 'rejected',
]);

/** A caller must load every session and all financial evidence for this order. */
export interface OrderTableReassignmentSnapshot {
  state: string;
  active_financial_split_id?: number | null;
  table_sessions: ReadonlyArray<{ id: number; closed_at: Date | string | null }>;
  payments: ReadonlyArray<{ state: string }>;
  invoices: ReadonlyArray<{ status: string }>;
}

export type TableReassignmentEligibility =
  | { eligible: true }
  | { eligible: false; errorCode: typeof ErrorCodes.ORD_TABLE_REASSIGN_ORDER_STATE_001.code; details: { state: string } }
  | { eligible: false; errorCode: typeof ErrorCodes.ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001.code; details: { reason: 'settled_payment' | 'active_financial_split' | 'issued_invoice' } }
  | { eligible: false; errorCode: typeof ErrorCodes.TABLE_SESSION_NOT_FOUND.code }
  | { eligible: false; errorCode: typeof ErrorCodes.TABLE_SESSION_ALREADY_OPEN.code };

/** Pure read-side policy. G.2 must re-read under its lifecycle lock before writing. */
export function canReassignOrderToTable(
  order: OrderTableReassignmentSnapshot,
): TableReassignmentEligibility {
  if (order.state === 'cancelled' || order.state === 'refunded') {
    return {
      eligible: false,
      errorCode: ErrorCodes.ORD_TABLE_REASSIGN_ORDER_STATE_001.code,
      details: { state: order.state },
    };
  }

  if (order.table_sessions.length === 0) {
    return { eligible: false, errorCode: ErrorCodes.TABLE_SESSION_NOT_FOUND.code };
  }

  if (order.table_sessions.some((session) => session.closed_at == null)) {
    return { eligible: false, errorCode: ErrorCodes.TABLE_SESSION_ALREADY_OPEN.code };
  }

  if (order.payments.some((payment) => SETTLED_PAYMENT_STATES.has(payment.state))) {
    return {
      eligible: false,
      errorCode: ErrorCodes.ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001.code,
      details: { reason: 'settled_payment' },
    };
  }

  if (order.active_financial_split_id != null) {
    return {
      eligible: false,
      errorCode: ErrorCodes.ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001.code,
      details: { reason: 'active_financial_split' },
    };
  }

  if (order.invoices.some((invoice) => NUMBERED_INVOICE_STATES.has(invoice.status))) {
    return {
      eligible: false,
      errorCode: ErrorCodes.ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001.code,
      details: { reason: 'issued_invoice' },
    };
  }

  return { eligible: true };
}
