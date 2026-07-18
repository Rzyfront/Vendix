import { IsEnum, IsOptional } from 'class-validator';

export enum ConfirmationSource {
  STAFF = 'staff',
  SYSTEM = 'system',
}

/**
 * DTO for `POST /store/reservations/:id/send-confirmation`.
 *
 * Triggers the double-validation flow: generates a confirmation token,
 * emails the customer a link, and lets them confirm or cancel via the
 * public `confirmByToken` endpoint.
 */
export class SendConfirmationDto {
  /// Where the request originated. `staff` (POS click) and `system` (cron /
  /// schedule automation) are the supported values.
  @IsOptional()
  @IsEnum(ConfirmationSource)
  source?: ConfirmationSource = ConfirmationSource.STAFF;
}
