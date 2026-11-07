import { createHash } from 'crypto';
import {
  WORKFLOW_EVENT_TOKENS,
  WORKFLOW_TRIGGER_EVENTS,
  WorkflowTriggerEvent,
} from '@common/workflows/contract';

type Json = Record<string, unknown>;

export interface TriggerEventInfo {
  store_id: number;
  /** Stable id of the business fact; part of the idempotency key. */
  business_id: string;
  /** Flat context: exactly the keys of `WORKFLOW_EVENT_TOKENS[event]`. */
  context: Record<string, string | number | boolean | null>;
}

const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Scalars only: Decimal → string, Date → ISO, anything structured → null. */
function scalar(v: unknown): string | number | boolean | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.slice(0, 2000);
  if (v instanceof Date) return v.toISOString();
  if (isObj(v) && typeof (v as { toFixed?: unknown }).toFixed === 'function') {
    // Prisma.Decimal / decimal.js
    return String(v);
  }
  return null;
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Keys of the payload that identify the business fact of each event (joined
 * with ":"), part of the idempotency key: the same fact never starts a flow
 * twice. Every event of the registry must be listed (spec enforces it).
 */
export const EVENT_BUSINESS_ID_KEYS: Record<WorkflowTriggerEvent, readonly string[]> = {
  'order.created': ['order_id'],
  'order.paid': ['order_id'],
  'order.status_changed': ['order_id', 'to_state', 'transition_id'],
  'invoice.created': ['invoice_id'],
  'invoice.voided': ['invoice_id'],
  'credit_note.created': ['credit_note_id'],
  'supplier_payment.registered': ['payment_id'],
  'payable.payment_registered': ['payment_id'],
  'purchase_order.created': ['purchase_order_id'],
  'purchase_order.approved': ['purchase_order_id'],
  'purchase_order.received': ['purchase_order_id', 'reception_id'],
  'expense.created': ['expense_id'],
  'expense.approved': ['expense_id'],
  'expense.paid': ['expense_id'],
  'payroll_run.approved': ['payroll_run_id'],
  'payroll_run.paid': ['payroll_run_id'],
  'inventory.adjusted': ['adjustment_id'],
  'inventory.transferred': ['transfer_id'],
  'stock.low': ['product_id', 'location_id', 'occurred_on'],
  'journal_entry.posted': ['journal_entry_id'],
  'fiscal_period.closed': ['fiscal_period_id'],
  'cash_session.opened': ['session_id'],
  'cash_session.closed': ['session_id'],
  'customer.created': ['customer_id'],
  'supplier.created': ['supplier_id'],
  'employee.created': ['employee_id'],
  'booking.created': ['booking_id'],
  'pqr.created': ['ticket_id'],
};

/** Ids are positive integers; any other identifying key is a short text. */
function idPart(v: unknown): string | null {
  const n = positiveInt(v);
  if (n !== null) return String(n);
  if (typeof v === 'string' && v.trim() !== '' && v.length <= 80) return v.trim();
  return null;
}

/**
 * Reads the payload of a registered business event into the store id, the
 * business id and the closed flat context (exactly the event's catalog
 * tokens). Returns null when the payload has no store (platform-level events
 * such as a platform PQR) or no business id. Never throws.
 */
export function extractTriggerEvent(
  event: string,
  payload: unknown,
): TriggerEventInfo | null {
  try {
    if (!(WORKFLOW_TRIGGER_EVENTS as readonly string[]).includes(event))
      return null;
    if (!isObj(payload)) return null;
    const e = event as WorkflowTriggerEvent;
    let source: Json = payload;
    let storeId: number | null = positiveInt(payload['store_id']);

    if (e === 'pqr.created') {
      const ticket = payload['ticket'];
      const contact = payload['contact'];
      if (!isObj(ticket)) return null;
      storeId = positiveInt(ticket['store_id']);
      source = {
        ticket_id: ticket['id'],
        ticket_number: ticket['ticket_number'],
        title: ticket['title'],
        description: ticket['description'],
        category: ticket['category'],
        contact_name: isObj(contact) ? contact['name'] : null,
        contact_email: isObj(contact) ? contact['email'] : null,
      };
    }

    const keys = EVENT_BUSINESS_ID_KEYS[e];
    const [first, ...rest] = keys;
    const head = idPart(source[first]);
    if (storeId === null || head === null) return null;
    const businessId = [head, ...rest.map((k) => idPart(source[k]) ?? '')].join(':');

    const context: TriggerEventInfo['context'] = {};
    for (const key of WORKFLOW_EVENT_TOKENS[e])
      context[key] = scalar(source[key]);
    return { store_id: storeId, business_id: businessId, context };
  } catch {
    return null;
  }
}

/** sha256(definition_id + event name + business id) */
export function triggerIdempotencyKey(
  definitionId: number,
  event: string,
  businessId: string,
): string {
  return createHash('sha256')
    .update(`${definitionId}|${event}|${businessId}`)
    .digest('hex');
}
