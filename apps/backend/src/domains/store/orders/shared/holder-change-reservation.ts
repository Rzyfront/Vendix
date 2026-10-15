import { Prisma } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

/** Lock order everywhere: order -> fiscal documents -> numbering/accounting. */
export async function lockHolderChangeOrder(
  tx: Prisma.TransactionClient,
  orderId: number,
  storeId: number,
  organizationId: number,
) {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT o.id FROM orders o JOIN stores s ON s.id = o.store_id
    WHERE o.id = ${orderId} AND o.store_id = ${storeId} AND s.organization_id = ${organizationId}
    FOR UPDATE OF o`;
  if (!rows.length)
    throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
}

export async function assertNoHolderChangeReservation(
  tx: Pick<Prisma.TransactionClient, 'invoice_holder_changes'>,
  orderId: number,
  storeId: number,
  allowedOperationId?: number,
) {
  const reserved = await tx.invoice_holder_changes.findFirst({
    where: {
      original_order_id: orderId,
      store_id: storeId,
      active_order_key: { not: null },
    },
    select: { id: true, phase: true },
  });
  if (reserved && reserved.id !== allowedOperationId) {
    throw new VendixHttpException(
      ErrorCodes.INVOICING_CREATE_002,
      'La orden tiene un cambio de titular en curso. Continúa esa operación antes de modificarla.',
      { operation_id: reserved.id, phase: reserved.phase },
    );
  }
}
