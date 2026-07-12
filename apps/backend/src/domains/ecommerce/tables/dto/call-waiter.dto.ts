import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * QR-por-mesa — GAP-5.
 *
 * Payload for the "call waiter" action from the diner storefront. The
 * optional `note` lets the diner attach a short free-text reason
 * (e.g. "necesito servilletas"). Persisted only inside the notification
 * `data` blob — no table/order mutation.
 */
export class CallWaiterDto {
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
