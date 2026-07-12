import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * QR-por-mesa — GAP-10.
 *
 * Payload for a diner (anonymous, @OptionalAuth) declaring how many
 * guests are seated at the table. The service validates the value against
 * `tables.capacity` before persisting it onto the active
 * `table_sessions.guest_count`.
 */
export class SetGuestCountDto {
  @IsInt()
  @Type(() => Number)
  @Min(1)
  guest_count!: number;
}
