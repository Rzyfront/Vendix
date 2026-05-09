import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Result of {@link syncRolePermissions}.
 *
 * - `added`: new `role_permissions` rows that did not exist before the call.
 * - `revoked`: stale `role_permissions` rows deleted because they were not in
 *   the canonical `allowedPermissionIds` set.
 */
export interface SyncRolePermissionsResult {
  added: number;
  revoked: number;
}

/**
 * Generic Prisma surface accepted by helpers that may run inside or outside
 * an `$transaction(...)` callback. Seeds use the singleton `PrismaClient`,
 * but services frequently pass a `Prisma.TransactionClient` — both expose the
 * same delegate methods we need (`role_permissions.{findMany,createMany,deleteMany}`).
 */
type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Synchronize the `role_permissions` rows for a given role to match the
 * canonical `allowedPermissionIds` set, in an idempotent and re-run-safe way.
 *
 * The seed historically grants permissions additively via `upsert`. When a
 * permission is removed from a role's filter (e.g. STORE_ADMIN losing
 * `store:inventory:suppliers:*` writes that move to ORG_ADMIN, or new
 * `organization:inventory:*` rows we never want manager to inherit), the
 * obsolete `role_permissions` rows must be explicitly deleted, otherwise
 * re-running the seed leaves stale assignments behind.
 *
 * Behaviour:
 *
 * 1. Inserts the missing rows with `createMany({ skipDuplicates: true })`.
 * 2. Revokes (deletes) any existing rows for `roleId` whose `permission_id`
 *    is **not** in `allowedPermissionIds`.
 * 3. Logs a single line with the net counts using `label` for traceability.
 *
 * Idempotency guarantees:
 *
 * - `createMany({ skipDuplicates: true })` relies on the
 *   `@@unique([role_id, permission_id])` constraint on `role_permissions`,
 *   so re-runs never duplicate rows.
 * - `deleteMany({ permission_id: { notIn } })` is a set-difference operation,
 *   so the second run sees an empty diff and is a no-op.
 *
 * @param client                Prisma client or transaction client.
 * @param roleId                The `roles.id` whose permission set we sync.
 * @param allowedPermissionIds  Canonical list of `permissions.id` the role
 *                              should have. Duplicates are deduped internally.
 * @param label                 Short human label used in log output (e.g.
 *                              `"STORE_ADMIN (manager)"`).
 *
 * @returns Counts of newly added and revoked rows.
 */
export async function syncRolePermissions(
  client: PrismaLike,
  roleId: number,
  allowedPermissionIds: number[],
  label: string,
): Promise<SyncRolePermissionsResult> {
  const allowedIds = Array.from(new Set(allowedPermissionIds));

  // 1. Insert missing assignments. `skipDuplicates` makes this safe on re-runs.
  let added = 0;
  if (allowedIds.length > 0) {
    const createResult = await client.role_permissions.createMany({
      data: allowedIds.map((permissionId) => ({
        role_id: roleId,
        permission_id: permissionId,
      })),
      skipDuplicates: true,
    });
    added = createResult.count;
  }

  // 2. Revoke stale assignments not present in the canonical set.
  const revokeResult = await client.role_permissions.deleteMany({
    where: {
      role_id: roleId,
      ...(allowedIds.length > 0
        ? { permission_id: { notIn: allowedIds } }
        : {}),
    },
  });
  const revoked = revokeResult.count;

  if (added > 0 || revoked > 0) {
    console.log(
      `   🔄 Synced ${label}: +${added} added, -${revoked} revoked (canonical=${allowedIds.length})`,
    );
  }

  return { added, revoked };
}
