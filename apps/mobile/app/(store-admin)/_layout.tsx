import { useEffect } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AdminShell } from '@/shared/layouts/admin-shell';
import { useAuthStore } from '@/core/store/auth.store';
import { colors } from '@/shared/theme';

const routeTitles: Record<string, string> = {
  dashboard: 'Panel Principal',
  pos: 'Punto de Venta',
  products: 'Productos',
  orders: 'Órdenes',
  inventory: 'Inventario',
  pop: 'Punto de Compra',
  purchase: 'Comprar Inventario',
  adjustments: 'Ajustes de Stock',
  transfers: 'Transferencias',
  movements: 'Movimientos',
  suppliers: 'Proveedores',
  locations: 'Ubicaciones',
  customers: 'Clientes',
  invoicing: 'Facturación',
  accounting: 'Contabilidad',
  expenses: 'Gastos',
  analytics: 'Analíticas',
  settings: 'Configuración',
  online_store: 'Tienda en línea',
  marketing: 'Marketing',
  help: 'Ayuda',
};

// Breadcrumb = sección padre + segmento current + ícono current (azul).
// Paridad con web `BreadcrumbService.routes` + `HeaderComponent`:
//   [icon parent] parent.label  /  [home blue] currentLabel
//
// El current label es independiente del h1 `title`.
const routeBreadcrumbParent: Record<string, { label: string; icon?: string }> = {
  dashboard: { label: 'Panel Administrativo', icon: 'layout-dashboard' },
  pos: { label: 'Tienda', icon: 'store' },
  products: { label: 'Tienda', icon: 'store' },
  orders: { label: 'Tienda', icon: 'store' },
  inventory: { label: 'Tienda', icon: 'store' },
  pop: { label: 'Inventario', icon: 'package' },
  purchase: { label: 'Inventario', icon: 'package' },
  adjustments: { label: 'Inventario', icon: 'package' },
  transfers: { label: 'Inventario', icon: 'package' },
  movements: { label: 'Inventario', icon: 'package' },
  suppliers: { label: 'Inventario', icon: 'package' },
  locations: { label: 'Inventario', icon: 'package' },
  customers: { label: 'Tienda', icon: 'store' },
  invoicing: { label: 'Tienda', icon: 'store' },
  accounting: { label: 'Tienda', icon: 'store' },
  expenses: { label: 'Tienda', icon: 'store' },
  analytics: { label: 'Tienda', icon: 'store' },
  online_store: { label: 'Tienda', icon: 'store' },
  marketing: { label: 'Tienda', icon: 'store' },
  settings: { label: 'Tienda', icon: 'store' },
  help: { label: 'Tienda', icon: 'store' },
};

/**
 * Etiqueta del segmento current del breadcrumb (final del path). Aparece
 * al lado del ícono home (azul). En STORE_ADMIN coincide con el segmento
 * de ruta activo (ej. "Productos", "Inventario") — independiente del h1.
 */
const routeBreadcrumbCurrent: Record<string, string> = {
  dashboard: 'Panel Principal',
  pos: 'Punto de Venta',
  products: 'Productos',
  orders: 'Órdenes',
  inventory: 'Inventario',
  pop: 'Punto de Compra',
  purchase: 'Comprar Inventario',
  adjustments: 'Ajustes de Stock',
  transfers: 'Transferencias',
  movements: 'Movimientos',
  suppliers: 'Proveedores',
  locations: 'Ubicaciones',
  customers: 'Clientes',
  invoicing: 'Facturación',
  accounting: 'Contabilidad',
  expenses: 'Gastos',
  analytics: 'Analíticas',
  settings: 'Configuración',
  online_store: 'Tienda en línea',
  marketing: 'Marketing',
  help: 'Ayuda',
};

export default function StoreAdminLayout() {
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
      variant="store"
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
