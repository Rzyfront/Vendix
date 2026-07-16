import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * QR-por-mesa — Pago del comensal.
 *
 * Payload for `POST /ecommerce/tables/:token/pay`. The diner selects a
 * store-scoped payment method (`cash`, `bank_transfer`, `wompi`, …) and
 * optionally specifies the amount/payment_reference/tip.
 *
 * - `store_payment_method_id` MUST belong to the current store
 *   (`StorePrismaService` auto-scope). Anonymous diners are supported —
 *   payment is committed against `table_sessions.order_id`, never against
 *   a customer.
 * - `amount` defaults to the open session's `order.grand_total` when
 *   omitted (server-side resolution — the client never sets the total).
 * - `payment_reference` is the free-text reference the diner pastes for
 *   bank_transfer (e.g. the bank's transaction id).
 * - `tip_amount` is an optional tip added on top of the bill; reserved
 *   for future tip-bookkeeping, ignored at v1.
 *
 * Endpoint enforces `restaurant.enable_table_checkout === true`
 * SERVER-SIDE (see `EcommerceTablesService.payTable`) — the DTO does not
 * carry that flag (anti-mass-assignment: `forbidNonWhitelisted`).
 */
export class PayTableDto {
  @IsInt()
  @IsPositive()
  store_payment_method_id: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  payment_reference?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tip_amount?: number;
}
