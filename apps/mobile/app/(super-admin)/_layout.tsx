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

// Breadcrumb = sección padre + segmento current + ícono current (azul).
// Paridad con web `BreadcrumbService.routes` + `HeaderComponent`:
//   [shield] Super admin  /  [home blue] currentLabel
const routeBreadcrumbParent: Record<string, { label: string; icon?: string }> = {
  dashboard: { label: 'Super admin', icon: 'shield' },
  organizations: { label: 'Super admin', icon: 'shield' },
  stores: { label: 'Super admin', icon: 'shield' },
  users: { label: 'Super admin', icon: 'shield' },
  subscriptions: { label: 'Super admin', icon: 'shield' },
  'ai-engine': { label: 'Super admin', icon: 'shield' },
  monitoring: { label: 'Super admin', icon: 'shield' },
  settings: { label: 'Super admin', icon: 'shield' },
};

/**
 * Etiqueta del segmento current del breadcrumb (final del path). Aparece
 * al lado del ícono home (azul). Independiente del h1 `title`.
 */
const routeBreadcrumbCurrent: Record<string, string> = {
  dashboard: 'Dashboard',
  organizations: 'Organizaciones',
  stores: 'Tiendas',
  users: 'Usuarios',
  subscriptions: 'Suscripciones',
  'ai-engine': 'AI Engine',
  monitoring: 'Monitoreo',
  settings: 'Configuración',
};

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
  const parent = routeBreadcrumbParent[currentSegment];
  const currentLabel = routeBreadcrumbCurrent[currentSegment];
  // Componemos el breadcrumb aquí (paridad con web `app-header.breadcrumb`).
  // AdminShell sólo acepta un string `breadcrumb` — los props
  // `parentIcon`/`currentIcon` aún no se renderizan (PosHeader no los
  // soporta); se quitarán cuando se implemente breadcrumb con iconos.
  const breadcrumb = parent ? `${parent.label} / ${currentLabel}` : currentLabel;

  return (
    <AdminShell title={title} breadcrumb={breadcrumb} variant="super">
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
