/**
 * Layaway (Plan Separé) domain types — mobile mirror of
 * `apps/frontend/src/app/private/modules/store/layaway/interfaces/layaway.interface.ts`
 * (desktop Angular) and `apps/backend/src/domains/store/layaway/dto/index.ts`
 * (NestJS DTO).
 *
 * The backend endpoint `POST /store/layaway` is the source of truth and is
 * implemented in `apps/backend/src/domains/store/layaway/layaway.service.ts:26-198`.
 * The body shape is:
 *   - items[]: must sum to the cart total (after discount/tax) per line
 *   - installments[]: must sum to (total_amount - down_payment_amount) — backend
 *     rejects with `LAY_INSTALLMENT_001` otherwise. Our pure helper
 *     `buildLayawaySchedule` (utils/layaway-schedule.ts) guarantees this sum
 *     exactly by absorbing the rounding remainder into the last installment.
 *
 * The Plan Separé flow in mobile POS is implemented in
 * `features/pos/components/pos-layaway-config-modal.tsx` (see QUI-499).
 */

/** ============================================================
 *  Response entities (read after POST returns the created plan)
 *  ============================================================ */

export type LayawayPlanState =
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'overdue'
  | 'defaulted';

export type LayawayInstallmentState =
  | 'pending'
  | 'paid'
  | 'overdue'
  | 'cancelled';

export interface LayawayItem {
  id: number;
  layaway_plan_id: number;
  product_id: number;
  product_variant_id: number | null;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  subtotal: number;
  location_id: number | null;
  products?: { id: number; name: string; sku: string };
  product_variants?: { id: number; name: string; sku: string } | null;
  inventory_locations?: { id: number; name: string; code: string } | null;
}

export interface LayawayInstallment {
  id: number;
  layaway_plan_id: number;
  installment_number: number;
  amount: number;
  due_date: string;
  state: LayawayInstallmentState;
  paid_at: string | null;
  reminder_sent_at: string | null;
}

export interface LayawayPayment {
  id: number;
  layaway_plan_id: number;
  layaway_installment_id: number | null;
  amount: number;
  currency: string | null;
  store_payment_method_id: number | null;
  transaction_id: string | null;
  state: string;
  paid_at: string | null;
  notes: string | null;
  received_by_user_id: number | null;
  store_payment_methods?: { id: number; display_name: string } | null;
  received_by?: { id: number; first_name: string; last_name: string } | null;
}

export interface LayawayPlan {
  id: number;
  store_id: number;
  customer_id: number;
  plan_number: string;
  state: LayawayPlanState;
  total_amount: number;
  down_payment_amount: number;
  paid_amount: number;
  remaining_amount: number;
  currency: string | null;
  num_installments: number;
  notes: string | null;
  internal_notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  customer?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  };
  created_by?: {
    id: number;
    first_name: string;
    last_name: string;
  };
  layaway_items?: LayawayItem[];
  layaway_installments?: LayawayInstallment[];
  layaway_payments?: LayawayPayment[];
}

/** ============================================================
 *  Request DTOs (mobile→backend)
 *  ============================================================ */

/** Body item — backend requires int `product_id`. Custom items (id=0) are NOT supported. */
export interface LayawayItemInput {
  product_id: number;
  product_variant_id?: number;
  product_name: string;
  variant_name?: string;
  sku?: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  tax_amount?: number;
  location_id?: number;
}

/** Body installment — `due_date` is ISO `yyyy-MM-dd` per backend `IsDateString`. */
export interface LayawayInstallmentInput {
  amount: number;
  due_date: string;
}

export interface CreateLayawayRequest {
  customer_id: number;
  currency?: string;
  /** Optional initial payment amount. Must be `>= 0` and `< total_amount`. */
  down_payment_amount?: number;
  /**
   * Optional payment method for the initial deposit. Per y0ner's decision (Q2)
   * the mobile config modal does NOT capture this — it stays `null` and is set
   * later at the layaway list detail (`/admin/orders/layaway/{id}/payment`).
   */
  down_payment_method_id?: number;
  notes?: string;
  internal_notes?: string;
  items: LayawayItemInput[];
  installments: LayawayInstallmentInput[];
}

export interface MakePaymentRequest {
  amount: number;
  installment_id?: number;
  store_payment_method_id?: number;
  transaction_id?: string;
  notes?: string;
}

export interface ModifyInstallmentsRequest {
  installments: {
    id?: number;
    amount: number;
    due_date: string;
  }[];
}

export interface CancelLayawayRequest {
  cancellation_reason: string;
}

export interface LayawayQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  state?: string;
  customer_id?: number;
}

export interface LayawayStats {
  active: number;
  completed: number;
  overdue: number;
  total_receivable: number;
}