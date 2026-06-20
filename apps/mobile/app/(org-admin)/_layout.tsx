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
  application: 'General',
  'payment-methods': 'Métodos de pago',
};

/**
 * Breadcrumb = sección padre. Paridad con web `BreadcrumbService.routes`
 * (parent + icon). El current se renderiza implícitamente con `currentIcon`
 * desde el `title` actual + ícono home (default).
 *
 * "Panel administrativo" es la sección padre del ORG_ADMIN — mismo label que
 * aparece en el side menu del web.
 */
const routeBreadcrumbParent: Record<string, { label: string; icon?: string }> = {
  dashboard: { label: 'Panel Administrativo', icon: 'layout-dashboard' },
  stores: { label: 'Panel Administrativo', icon: 'layout-dashboard' },
  users: { label: 'Panel Administrativo', icon: 'layout-dashboard' },
  roles: { label: 'Panel Administrativo', icon: 'layout-dashboard' },
  orders: { label: 'Panel Administrativo', icon: 'layout-dashboard' },
  subscriptions: { label: 'Panel Administrativo', icon: 'layout-dashboard' },
  settings: { label: 'Panel Administrativo', icon: 'layout-dashboard' },
  'operating-scope': { label: 'Panel Administrativo', icon: 'layout-dashboard' },
  application: { label: 'Configuración', icon: 'settings' },
  'payment-methods': { label: 'Configuración', icon: 'settings' },
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
    return <View style={styles.loader} />;
  }

  if (!isAuthenticated) {
    return null;
  }

  const currentSegment = pathname.split('/').pop() || 'dashboard';
  const title = routeTitles[currentSegment] || 'Vendix';
  const parent = routeBreadcrumbParent[currentSegment];

  return (
    <AdminShell
      title={title}
      parentLabel={parent?.label}
      parentIcon={parent?.icon}
      currentIcon="home"
      variant="org"
    >
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