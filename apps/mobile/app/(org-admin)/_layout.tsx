import { useEffect } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AdminShell } from '@/shared/layouts/admin-shell';
import { useAuthStore } from '@/core/store/auth.store';

const routeTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  stores: 'Todas las tiendas',
  users: 'Todos los usuarios',
  roles: 'Roles y permisos',
  orders: 'Todas las órdenes',
  subscriptions: 'Suscripción',
  settings: 'Configuración',
  'operating-scope': 'Modo operativo',
  application: 'General',
  'payment-methods': 'Métodos de pago',
  domains: 'Dominios',
  logs: 'Registros de auditoría',
  sessions: 'Sesiones',
  'login-attempts': 'Intentos de inicio de sesión',
};

/**
 * Breadcrumb = sección padre + segmento current + ícono current (azul).
 * Paridad con web `BreadcrumbService.routes` + `HeaderComponent`:
 *   [layout-dashboard] Panel Administrativo  /  [home blue] currentLabel
 *
 * El current label es el segmento de ruta activo en minúscula inicial
 * (ej. "panel principal", "Tiendas"). El h1 grande (title) es independiente.
 *
 * "Panel Administrativo" es la sección padre del ORG_ADMIN — mismo label
 * que aparece en el side menu del web.
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
  domains: { label: 'Panel Administrativo', icon: 'layout-dashboard' },
  logs: { label: 'Auditoría y Cumplimiento', icon: 'shield' },
  sessions: { label: 'Auditoría y Cumplimiento', icon: 'shield' },
  'login-attempts': { label: 'Auditoría y Cumplimiento', icon: 'shield' },
};

/**
 * Etiqueta del segmento current del breadcrumb (final del path). Aparece
 * al lado del ícono home (azul) — independiente del h1 `title`.
 *
 * Ej: ruta /panel principal → currentLabel = "panel principal" pero
 * title (h1) = "Dashboard".
 */
const routeBreadcrumbCurrent: Record<string, string> = {
  dashboard: 'panel principal',
  stores: 'Tiendas',
  users: 'Usuarios',
  roles: 'Roles',
  orders: 'Órdenes',
  subscriptions: 'Suscripciones',
  settings: 'Configuración',
  'operating-scope': 'Modo operativo',
  application: 'General',
  'payment-methods': 'Métodos de pago',
  domains: 'Dominios',
  logs: 'Registros de auditoría',
  sessions: 'Sesiones',
  'login-attempts': 'Intentos de inicio de sesión',
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
  const currentLabel = routeBreadcrumbCurrent[currentSegment];

  return (
    <AdminShell
      title={title}
      parentLabel={parent?.label}
      parentIcon={parent?.icon}
      currentLabel={currentLabel}
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