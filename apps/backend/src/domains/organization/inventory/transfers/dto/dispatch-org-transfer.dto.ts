import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Optional dispatch payload for org-level stock transfers.
 *
 * Dispatch is the physical step where origin stock is decremented and the
 * transfer enters `in_transit`. The `notes` field is appended to the
 * existing transfer notes for traceability.
 */
export class DispatchOrgTransferDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
