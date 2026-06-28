import { useMemo } from 'react';
import { useAuthStore } from '@/core/store/auth.store';

export type Permission =
  | 'store:products:create'
  | 'store:products:update'
  | 'store:products:delete'
  | 'store:brands:create'
  | 'store:brands:update'
  | 'store:brands:delete'
  | 'store:categories:create'
  | 'store:categories:update'
  | 'store:categories:delete';

export function usePermissions() {
  const permissions = useAuthStore((s) => s.permissions);
  const roles = useAuthStore((s) => s.roles);

  return useMemo(() => {
    const set = new Set<string>(permissions ?? []);
    // Owners and admins implicitly get everything in their org/store
    const isAdmin = (roles ?? []).some((r) => r === 'owner' || r === 'admin' || r === 'super_admin');

    function can(permission: Permission): boolean {
      if (isAdmin) return true;
      return set.has(permission);
    }

    return {
      can,
      permissions: set,
      roles,
      isAdmin,
    };
  }, [permissions, roles]);
}

export function useCan(permission: Permission): boolean {
  const { can } = usePermissions();
  return can(permission);
}