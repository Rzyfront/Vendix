import { useEffect } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import { View } from 'react-native';
import { AdminShell } from '@/shared/layouts/admin-shell';
import { useAuthStore } from '@/core/store/auth.store';

const routeTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  stores: 'Tiendas',
  users: 'Usuarios',
  roles: 'Roles',
  orders: 'Órdenes',
  subscriptions: 'Suscripciones',
  settings: 'Configuración',
};

export default function OrgAdminLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading) {
    return <View className="flex-1 bg-white" />;
  }

  if (!isAuthenticated) {
    return null;
  }

  const currentSegment = pathname.split('/').pop() || 'dashboard';
  const title = routeTitles[currentSegment] || 'Vendix';

  return (
    <AdminShell title={title} variant="org">
      <Slot />
    </AdminShell>
  );
}
