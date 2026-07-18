import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for `POST /api/store/table-sessions/:id/payments/:paymentId/confirm`
 * (Restaurant Suite — table redesign C3).
 *
 * Body is intentionally minimal: the confirmation is a state transition
 * (pending → succeeded) plus an accounting emit, not an order mutation.
 *
 * - `tip_amount` is OPTIONAL. NOTE: the `payments` table does NOT carry a
 *   tip column — tips live on `orders.tip_amount` and are normally set at
 *   order creation / C2 bill-request. We accept the field here so the
 *   frontend can echo back the customer's intent, but the C3 confirmation
 *   path does NOT mutate `orders.tip_amount` (that would require re-running
 *   the order-totals derivation). Future C-stream tickets can wire this
 *   in if the product owner wants staff to add a tip during confirmation.
 */
export class ConfirmTablePaymentDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  tip_amount?: number;
}