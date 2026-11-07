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
 * Reads the payload of one of the six business events into the store id, the
 * business id and the closed flat context. Returns null when the payload has
 * no store (platform-level events such as a platform PQR) or no business id.
 * Never throws.
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
    let businessId: string | null = null;
    const ticket = payload['ticket'];
    const contact = payload['contact'];

    switch (e) {
      case 'order.created':
      case 'order.paid': {
        const id = positiveInt(payload['order_id']);
        businessId = id === null ? null : String(id);
        break;
      }
      case 'purchase_order.received': {
        const id = positiveInt(payload['purchase_order_id']);
        businessId =
          id === null
            ? null
            : `${id}:${positiveInt(payload['reception_id']) ?? ''}`;
        break;
      }
      case 'expense.approved': {
        const id = positiveInt(payload['expense_id']);
        businessId = id === null ? null : String(id);
        break;
      }
      case 'customer.created': {
        const id = positiveInt(payload['customer_id']);
        businessId = id === null ? null : String(id);
        break;
      }
      case 'pqr.created': {
        if (!isObj(ticket)) return null;
        storeId = positiveInt(ticket['store_id']);
        const id = positiveInt(ticket['id']);
        businessId = id === null ? null : String(id);
        source = {
          ticket_id: ticket['id'],
          ticket_number: ticket['ticket_number'],
          title: ticket['title'],
          description: ticket['description'],
          category: ticket['category'],
          contact_name: isObj(contact) ? contact['name'] : null,
          contact_email: isObj(contact) ? contact['email'] : null,
        };
        break;
      }
    }
    if (storeId === null || businessId === null) return null;

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
