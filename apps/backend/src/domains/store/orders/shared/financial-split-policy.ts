import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * Asserts that an order does not have an active financial split.
 * When an order has been split into independent financial accounts,
 * whole-order invoicing is blocked to prevent double counting.
 */
export function assertNoActiveFinancialSplit(order: {
  active_financial_split_id?: number | null;
  active_financial_split?: unknown | null;
}): void {
  if (order?.active_financial_split_id || order?.active_financial_split) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_CREATE_003,
      'La orden tiene una cuenta financiera activa; factura cada cuenta individualmente.',
    );
  }
}
