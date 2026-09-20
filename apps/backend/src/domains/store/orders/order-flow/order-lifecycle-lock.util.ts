import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** All lifecycle writers lock the order BEFORE payments or inventory. */
export async function lockOrderLifecycle(
  tx: Prisma.TransactionClient,
  orderId: number,
  storeId: number,
): Promise<{ id: number; state: string }> {
  // Raw SQL is not tenant-scoped by Prisma; storeId must come from a scoped
  // lookup (or the webhook's resolved order), never from a request body.
  const rows = await tx.$queryRaw<Array<{ id: number; state: string }>>`
    SELECT id, state FROM orders
    WHERE id = ${orderId} AND store_id = ${storeId}
    FOR UPDATE
  `;
  if (!rows.length) throw new NotFoundException(`Order #${orderId} not found`);
  await tx.$queryRaw`
    SELECT id FROM payments WHERE order_id = ${orderId} ORDER BY id FOR UPDATE
  `;
  return rows[0];
}
