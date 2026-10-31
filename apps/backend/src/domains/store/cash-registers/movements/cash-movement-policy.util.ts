import { VendixHttpException, ErrorCodes } from '@common/errors';

/**
 * Single source of truth: does a payment made by staff through a counter
 * flow (POS `processPosPayment`, order `flow/pay`, credit payments) leave a
 * `sale` row in `cash_register_movements`?
 *
 * Decision table (evaluated top to bottom):
 *
 * | methodType (system_payment_method.type) | processingMode | records |
 * |------------------------------------------|----------------|---------|
 * | missing / empty                          | any            | throws `PAY_METHOD_MISCONFIGURED` |
 * | any                                      | ON_DELIVERY    | no (the courier collects it; it is a promise, not money in the drawer) |
 * | cash_on_delivery                         | any            | no (same reason) |
 * | wompi                                    | any            | no (money stays at the gateway) |
 * | wallet                                   | any            | no (internal balance, no cash enters) |
 * | cash, card, bank_transfer, voucher, ...  | other          | yes (the closing count only sums `cash`; non-cash rows are informative) |
 *
 * POS and `flow/pay` used to disagree: the POS skipped the four gateway /
 * on-delivery cases while `flow/pay` recorded every method, and an unknown
 * type counted as `'cash'` in the POS but as `''` (never counted) in
 * `flow/pay`. Both now share this function (B08, B26).
 *
 * @throws VendixHttpException PAY_METHOD_MISCONFIGURED when `methodType` is falsy.
 */
export function shouldRecordCashMovement(
  methodType: string | null | undefined,
  processingMode?: string | null,
): boolean {
  if (!methodType) {
    throw new VendixHttpException(ErrorCodes.PAY_METHOD_MISCONFIGURED);
  }
  if (processingMode === 'ON_DELIVERY') return false;
  return !['cash_on_delivery', 'wompi', 'wallet'].includes(methodType);
}
