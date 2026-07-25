import { apiClient, Endpoints } from '@/core/api';
import type { ApiResponse } from '../types';
import type { LayawayPlan, CreateLayawayRequest } from '../types/layaway.types';

/**
 * Layaway (Plan Separé) HTTP service — thin wrapper around `POST /store/layaway`.
 *
 * The mobile POS Plan Separé flow (QUI-499) only uses `create()` at the moment.
 * Other endpoints (`list`, `getById`, `makePayment`, `cancel`, `complete`, …) are
 * registered in `core/api/endpoints.ts` so a follow-up mobile-parity PR can plug
 * them in without re-touching the surface area.
 *
 * Error mapping is intentionally NOT done here. The service rethrows the
 * axios error so the modal can decide what to surface (toast, retry, etc.).
 * See the error table in the plan §4.
 */

function unwrap<T>(response: { data: T | ApiResponse<T> }): T {
  const d = response.data as ApiResponse<T>;
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

export const LayawayService = {
  /**
   * Create a layaway plan from the mobile POS cart.
   *
   * @param data — `CreateLayawayRequest`. `installments` MUST sum to
   *   `total_amount - down_payment_amount` or the backend rejects with
   *   `LAY_INSTALLMENT_001`. The `buildLayawaySchedule` helper
   *   (utils/layaway-schedule.ts) guarantees this invariant exactly.
   */
  async create(data: CreateLayawayRequest): Promise<LayawayPlan> {
    const res = await apiClient.post(Endpoints.STORE.LAYAWAY.CREATE, data);
    return unwrap<LayawayPlan>(res);
  },
};
