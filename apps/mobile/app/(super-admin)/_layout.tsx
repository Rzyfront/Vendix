import { useEffect } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AdminShell } from '@/shared/layouts/admin-shell';
import { useAuthStore } from '@/core/store/auth.store';

const routeTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  organizations: 'Organizaciones',
  stores: 'Tiendas',
  users: 'Usuarios',
  subscriptions: 'Suscripciones',
  'ai-engine': 'AI Engine',
  monitoring: 'Monitoreo',
  settings: 'Configuración',
};

// Breadcrumb = sección padre (sin rutas hijas con padre en super-admin actualmente)
const routeBreadcrumbs: Record<string, string> = {};

export default function SuperAdminLayout() {
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
    <AdminShell title={title} breadcrumb={breadcrumb} variant="super">
      <Slot />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
