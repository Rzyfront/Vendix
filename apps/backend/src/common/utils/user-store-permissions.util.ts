import { buildActiveUserRolesWhere } from './role-scope.util';

/** Minimal Prisma surface the resolver needs (global or store client). */
export interface UserRolesReader {
  user_roles: {
    findMany(args: unknown): Promise<
      Array<{
        roles?: {
          role_permissions?: Array<{
            permissions?: { name?: string | null; status?: string | null } | null;
          }>;
        } | null;
      }>
    >;
  };
}

/**
 * Permission names a user really holds in a store. Same resolution the JWT
 * strategy does at login: role assignments valid in this store
 * (store-specific or organization-wide), then their ACTIVE permission rows.
 * Shared by the API key guard and the workflow actions executor so neither
 * grants a permission the user does not have.
 */
export async function resolveUserStorePermissions(
  prisma: UserRolesReader,
  userId: number,
  storeId: number,
): Promise<string[]> {
  const userRoles = await prisma.user_roles.findMany({
    where: buildActiveUserRolesWhere(userId, storeId),
    include: {
      roles: {
        include: { role_permissions: { include: { permissions: true } } },
      },
    },
  });
  const names = new Set<string>();
  for (const ur of userRoles) {
    for (const rp of ur.roles?.role_permissions ?? []) {
      const p = rp.permissions;
      if (p && p.status === 'active' && p.name) names.add(p.name);
    }
  }
  return [...names];
}
