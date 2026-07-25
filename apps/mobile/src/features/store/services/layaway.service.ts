import { apiClient, Endpoints } from '@/core/api';
import type { ApiResponse } from '../types';
import type {
  LayawayPlan,
  CreateLayawayRequest,
  MakePaymentRequest,
  ModifyInstallmentsRequest,
  CancelLayawayRequest,
  LayawayQueryParams,
  LayawayStats,
} from '../types/layaway.types';

/**
 * Layaway (Plan Separé) HTTP service — thin wrapper around `POST /store/layaway`.
 *
 * The mobile POS Plan Separé flow (QUI-499) only uses `create()` at the moment;
 * the other endpoints are stubbed so future mobile-parity PRs (list, detail,
 * payment, cancel, complete, etc.) can plug in without re-touching the service
 * surface. Backend reference: `apps/backend/src/domains/store/layaway/`.
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

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        value.forEach((v) => parts.push(`${key}=${encodeURIComponent(String(v))}`));
      } else {
        parts.push(`${key}=${encodeURIComponent(String(value))}`);
      }
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
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

  /** Stub for future PR — list layaway plans for a store (paginated). */
  async list(_query?: LayawayQueryParams): Promise<LayawayPlan[]> {
    throw new Error('LayawayService.list not implemented yet (future PR)');
  },

  /** Stub for future PR — fetch a single layaway plan with relations. */
  async getById(_id: number): Promise<LayawayPlan> {
    throw new Error('LayawayService.getById not implemented yet (future PR)');
  },

  /** Stub for future PR — layaway stats for dashboard. */
  async getStats(): Promise<LayawayStats> {
    throw new Error('LayawayService.getStats not implemented yet (future PR)');
  },

  /** Stub for future PR — record a payment against an installment. */
  async makePayment(_id: number, _data: MakePaymentRequest): Promise<LayawayPlan> {
    throw new Error('LayawayService.makePayment not implemented yet (future PR)');
  },

  /** Stub for future PR — edit installment amounts/dates. */
  async modifyInstallments(
    _id: number,
    _data: ModifyInstallmentsRequest,
  ): Promise<LayawayPlan> {
    throw new Error(
      'LayawayService.modifyInstallments not implemented yet (future PR)',
    );
  },

  /** Stub for future PR — cancel a plan with reason. */
  async cancel(_id: number, _data: CancelLayawayRequest): Promise<LayawayPlan> {
    throw new Error('LayawayService.cancel not implemented yet (future PR)');
  },

  /** Stub for future PR — force-complete a plan. */
  async complete(_id: number): Promise<LayawayPlan> {
    throw new Error('LayawayService.complete not implemented yet (future PR)');
  },
};

export type LayawayServiceType = typeof LayawayService;
// Keep an unused reference so eslint/TS doesn't strip the `buildQuery` helper
// in case we wire `list()` in a later PR.
void buildQuery;