import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * QR-por-mesa — GAP-5.
 *
 * Payload for the "request the bill" action from the diner storefront.
 * Both fields are optional metadata carried into the staff notification
 * `data` blob; the endpoint does NOT mutate the order or take payment.
 *
 *   - `note`               short free-text (e.g. "traer datáfono").
 *   - `payment_preference` how the diner intends to pay so the mesero can
 *                          come prepared (`cash` | `card` | `split`).
 */
export class RequestBillDto {
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;

  @IsOptional()
  @IsIn(['cash', 'card', 'split'])
  payment_preference?: 'cash' | 'card' | 'split';
}
