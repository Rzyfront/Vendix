import { FinancialSplitErrors, VendixHttpException } from 'src/common/errors';

/** A financial split never forks the physical sale. Economic mutations must
 * cancel the allocation first; operational fire/fulfilment remains on source.
 */
export function assertNoActiveFinancialSplit(order: { active_financial_split_id?: number | null }): void {
  if (order.active_financial_split_id) {
    throw new VendixHttpException(
      FinancialSplitErrors.SPLIT_ACCOUNT_LOCKED,
      'La orden tiene cuentas independientes. Cobra y factura cada cuenta; cancela el reparto antes de modificar la venta.',
      { financial_split_id: order.active_financial_split_id },
    );
  }
}
