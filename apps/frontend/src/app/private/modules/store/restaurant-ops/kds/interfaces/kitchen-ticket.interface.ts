/**
 * Restaurant Suite — Phase F (KDS).
 * Source of truth for the Kitchen Display System domain in the frontend.
 *
 * Mirrors the Prisma models `kitchen_tickets` and `kitchen_ticket_items`
 * and the SSE envelope produced by
 * `apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts`.
 */

export type KitchenTicketStatus =
  | 'pending'
  | 'in_preparation'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export type KitchenTicketItemStatus = KitchenTicketStatus;

export interface KitchenTicketProductRef {
  id: number;
  name: string;
  sku?: string | null;
  stock_unit?: string | null;
}

export interface KitchenTicketItem {
  id: number;
  kitchen_ticket_id: number;
  order_item_id: number;
  product_id: number;
  quantity: number;
  status: KitchenTicketItemStatus;
  notes?: string | null;
  product?: KitchenTicketProductRef;
}

export interface KitchenTicket {
  id: number;
  store_id: number;
  order_id: number;
  daily_number?: number | null;
  order?: { order_number: string } | null;
  table_id?: number | null;
  status: KitchenTicketStatus;
  fired_at: string | Date;
  ready_at?: string | Date | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  items: KitchenTicketItem[];
}

/**
 * SSE envelope — a tagged union over the KDS event types. The server
 * emits one of these for every state change; the KDS page reconciles
 * the current `tickets` array using the embedded `ticket` payload.
 */
export type KdsEvent =
  | {
      type: 'snapshot';
      tickets: KitchenTicket[];
      total: number;
      server_ts: number;
      window_minutes: number;
      error?: string;
    }
  | {
      type: 'ticket.created';
      ticket: KitchenTicket;
      ts: number;
    }
  | {
      type: 'ticket.started';
      ticket: KitchenTicket;
      ts: number;
    }
  | {
      type: 'ticket.ready';
      ticket: KitchenTicket;
      ts: number;
    }
  | {
      type: 'ticket.delivered';
      ticket: KitchenTicket;
      ts: number;
    }
  | {
      type: 'ticket.cancelled';
      ticket: KitchenTicket;
      ts: number;
    };

export interface KdsSnapshotResponse {
  tickets: KitchenTicket[];
  total: number;
  server_ts: number;
  window_minutes: number;
}

/**
 * Column definition for the KDS board. Mirrors the `pending → ready`
 * workflow. `delivered` and `cancelled` are soft columns that hold the
 * most recent closed tickets so the kitchen can see what just left —
 * kept visually distinct (green vs red) instead of mixed together.
 */
export type KdsColumn =
  | 'pending'
  | 'in_preparation'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export const KDS_COLUMNS: readonly KdsColumn[] = [
  'pending',
  'in_preparation',
  'ready',
  'delivered',
  'cancelled',
] as const;
