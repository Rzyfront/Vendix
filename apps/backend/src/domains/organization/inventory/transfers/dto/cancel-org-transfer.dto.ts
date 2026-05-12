import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload for cancelling an org-level stock transfer.
 *
 * `reason` is appended to the transfer notes for audit and is captured in
 * the inventory movement metadata when stock is returned to origin (when
 * cancelling an `in_transit` transfer).
 */
export class CancelOrgTransferDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
