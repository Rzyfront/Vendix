import type { Prisma } from '@prisma/client';
import { FinancialSplitErrors, VendixHttpException } from 'src/common/errors';
import { isOrderFullyPaid } from '../../payments/services/payment-validator.service';

type SplitMoney = Prisma.Decimal | number | string;

/** Snapshot minimo para decidir si el reparto financiero ya esta saldado. */
export interface FinancialSplitSettlementSnapshot {
  active_financial_split_id?: number | null;
  grand_total?: SplitMoney | null;
  payments?: ReadonlyArray<{ state: string; amount?: SplitMoney | null }> | null;
  refunds?: ReadonlyArray<{ state?: string | null; amount?: SplitMoney | null }> | null;
}

/**
 * Reparto activo Y la suma de pagos liquidados cubre `grand_total` (todas las
 * cuentas pagadas). Solo habilita el CIERRE de ciclo de vida (finalizar /
 * confirm_delivery / fast_track); toda mutacion de dinero (pay, cancel_payment,
 * edit, cancel, confirm_payment, credit_payment) sigue bloqueada por
 * `assertNoActiveFinancialSplit` / `isFinancialSplitLocked`. Mismo criterio de
 * liquidacion que `canPay` (`isOrderFullyPaid`).
 */
export function isFinancialSplitSettled(order: FinancialSplitSettlementSnapshot): boolean {
  if (!order.active_financial_split_id) return false;
  if (!(Number(order.grand_total ?? 0) > 0)) return false;
  return isOrderFullyPaid({
    grand_total: order.grand_total,
    payments: (order.payments ?? []).map((p) => ({ state: p.state, amount: p.amount ?? 0 })),
    refunds: (order.refunds ?? []).map((r) => ({ state: r.state ?? '', amount: r.amount ?? 0 })),
  });
}

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
