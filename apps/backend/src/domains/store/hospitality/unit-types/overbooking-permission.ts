import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/** H1.6 — permission that governs how far a type may be overbooked. */
export const OVERBOOKING_PERMISSION = 'store:lodging:rates:write';

/**
 * Overbooking is a revenue decision: only owners, super admins or users with
 * `rates:write` change it (the endpoint itself needs `inventory:write`).
 */
export function assertCanChangeOverbooking(): void {
  const context = RequestContextService.getContext();
  if (
    context?.is_super_admin ||
    context?.is_owner ||
    context?.permissions?.includes(OVERBOOKING_PERMISSION)
  ) {
    return;
  }
  throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_OVERBOOKING_001);
}
