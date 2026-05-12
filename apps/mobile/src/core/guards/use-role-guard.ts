import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import type { RoleName } from '../models/environment.enum';
import { useAuthStore } from '../store/auth.store';

export function useRoleGuard(
  allowedRoles: RoleName[],
  redirectTo?: string
) {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/(auth)/login');
      return;
    }
    const hasRole = user?.roles?.some((role) => allowedRoles.includes(role as RoleName));
    if (!hasRole && redirectTo) {
      router.replace(redirectTo);
    }
  }, [user, isAuthenticated, isLoading, allowedRoles, redirectTo, router]);

  return user?.roles?.some((role) => allowedRoles.includes(role as RoleName)) ?? false;
}
