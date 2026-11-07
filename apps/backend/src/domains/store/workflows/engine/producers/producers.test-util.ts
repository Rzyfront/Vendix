import { RequestContextService } from '../../../../../common/context/request-context.service';

/** Request context of a store admin, for specs that exercise a producer. */
export function runAsStoreAdmin<T>(
  callback: () => T,
  ids: { store_id?: number; organization_id?: number; user_id?: number } = {},
): T {
  return RequestContextService.run(
    {
      user_id: ids.user_id ?? 7,
      organization_id: ids.organization_id ?? 3,
      store_id: ids.store_id ?? 11,
      is_super_admin: false,
      is_owner: true,
    },
    callback,
  );
}

/**
 * `$transaction` double: runs the callback with `tx` and re-throws what it
 * throws, like Prisma (a throwing callback rolls the whole unit back).
 */
export function transactionOf<Tx>(tx: Tx) {
  return jest.fn(async (callback: (client: Tx) => Promise<unknown>) =>
    callback(tx),
  );
}

/**
 * Prisma fields the approval gate (P1.3) reads before a governed write: a
 * store without the flows industry, so no flow governs the operation.
 */
export function noGoverningFlow() {
  return {
    withoutScope: () => ({ stores: { findFirst: async () => null } }),
  };
}
