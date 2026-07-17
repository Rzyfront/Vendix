import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Optional identity hint attached to a "call waiter" request. Used in the
 * pre-session modes (mark_occupied / require_staff) where the diner has
 * identified via the welcome wizard (Step 3) but no `table_session` exists
 * yet — so the identity cannot be read from a session's order. When a
 * session IS open, the service prefers the session's customer over this
 * hint (see `EcommerceTablesService.callWaiter`).
 */
export class CallWaiterCustomerDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

/**
 * QR-por-mesa — GAP-5.
 *
 * Payload for the "call waiter" action from the diner storefront. The
 * optional `note` lets the diner attach a short free-text reason
 * (e.g. "necesito servilletas"). Persisted only inside the notification
 * `data` blob — no table/order mutation.
 *
 * Step 3 (welcome wizard) adds an optional `customer` identity hint so the
 * staff notification can name the diner even in pre-session modes.
 */
export class CallWaiterDto {
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CallWaiterCustomerDto)
  customer?: CallWaiterCustomerDto;
}
