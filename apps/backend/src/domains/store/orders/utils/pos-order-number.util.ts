/** The slice of a Prisma transaction client this numbering needs. */
export interface PosOrderNumberClient {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/**
 * Next store order number in the POS format `POS-YYYY-NNNN` (POS sales and
 * restaurant table checks share it, S7).
 *
 * Must run inside the transaction that inserts the order: the transaction
 * advisory lock serializes the store's numbering until that transaction
 * ends, so two checkouts or table openings cannot read the same last number
 * (a unique violation would abort the whole Postgres transaction).
 *
 * The highest sequence is read as a number: ordering the text would keep
 * returning "9999" once "10000" exists and repeat it against the unique
 * `(store_id, order_number)` index.
 */
export async function nextPosOrderNumber(
  tx: PosOrderNumberClient,
  storeId: number,
  now: Date = new Date(),
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`orders:pos_number:${storeId}`}))`;
  const prefix = `POS-${now.getFullYear()}`;
  const rows = await tx.$queryRaw<Array<{ seq: number | bigint | null }>>`
    SELECT MAX(CAST(split_part(order_number, '-', 3) AS integer)) AS seq
    FROM orders
    WHERE store_id = ${storeId} AND order_number ~ ${`^${prefix}-[0-9]+$`}
  `;
  const last = rows[0]?.seq;
  const sequence = last == null ? 1 : Number(last) + 1;
  return `${prefix}-${sequence.toString().padStart(4, '0')}`;
}
