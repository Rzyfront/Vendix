import { industryAllowsKey } from '../../../../common/access/module-industries';

/**
 * Flujos only exist for stores with the `administration` industry. Background
 * and public paths re-check it because the industry can change after a flow
 * was published. `db` must be an unscoped client.
 */
export async function storeAllowsFlows(
  db: { stores: { findFirst(args: unknown): Promise<any> } },
  storeId: number,
): Promise<boolean> {
  const store = await db.stores.findFirst({
    where: { id: storeId },
    select: { industries: true },
  });
  return !!store && industryAllowsKey('flows', store.industries);
}
