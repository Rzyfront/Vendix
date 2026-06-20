import { useEffect } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AdminShell } from '@/shared/layouts/admin-shell';
import { useAuthStore } from '@/core/store/auth.store';

const routeTitles: Record<string, string> = {
  dashboard: 'Panel principal',
  stores: 'Tiendas',
  users: 'Usuarios',
  roles: 'Roles',
  orders: 'Órdenes',
  subscriptions: 'Suscripciones',
  settings: 'Configuración',
  'operating-scope': 'Modo operativo',
};

// Breadcrumb = sección padre (sin rutas hijas con padre en org-admin actualmente, pero se deja para futuro)
const routeBreadcrumbs: Record<string, string> = {};

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
    return <View style={styles.loader} />;
  }

  if (!isAuthenticated) {
    return null;
  }

  const currentSegment = pathname.split('/').pop() || 'dashboard';
  const title = routeTitles[currentSegment] || 'Vendix';
  const breadcrumb = routeBreadcrumbs[currentSegment];

  return (
    <AdminShell title={title} breadcrumb={breadcrumb} variant="org">
      <Slot />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
});
