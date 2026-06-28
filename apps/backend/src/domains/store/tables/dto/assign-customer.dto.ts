import { IsInt, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO to (re)assign or detach the customer of the draft order backing an
 * open table session.
 *
 * Restaurant Suite — table redesign. `customer_id` is intentionally
 * nullable:
 *   - a positive integer binds an existing `users` row as the order's
 *     customer.
 *   - an explicit `null` detaches the customer (anonymous table check).
 *
 * The `@ValidateIf((_, v) => v !== null)` lets a literal `null` pass the
 * pipe (otherwise `forbidNonWhitelisted` + `@IsInt` would reject it),
 * while still enforcing `@IsInt @Min(1)` for any provided number.
 */
export class AssignCustomerDto {
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Type(() => Number)
  @Min(1)
  customer_id!: number | null;
}
