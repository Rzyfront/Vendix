/** The slice of a Prisma transaction client this numbering needs. */
export interface PosOrderNumberClient {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  orders: {
    findFirst(args: {
      where: { store_id: number; order_number: { startsWith: string } };
      orderBy: { order_number: 'desc' };
      select: { order_number: true };
    }): Promise<{ order_number: string } | null>;
  };
}

/**
 * Next store order number in the POS format `POS-YYYY-NNNN` (POS sales and
 * restaurant table checks share it, S7).
 *
 * Must run inside the transaction that inserts the order: the transaction
 * advisory lock serializes the store's numbering until that transaction
 * ends, so two checkouts or table openings cannot read the same last number
 * (a unique violation would abort the whole Postgres transaction).
 */
export async function nextPosOrderNumber(
  tx: PosOrderNumberClient,
  storeId: number,
  now: Date = new Date(),
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`orders:pos_number:${storeId}`}))`;
  const prefix = `POS-${now.getFullYear()}`;
  const last = await tx.orders.findFirst({
    where: { store_id: storeId, order_number: { startsWith: prefix } },
    orderBy: { order_number: 'desc' },
    select: { order_number: true },
  });
  const sequence = last ? parseInt(last.order_number.split('-')[2], 10) + 1 : 1;
  return `${prefix}-${sequence.toString().padStart(4, '0')}`;
}
