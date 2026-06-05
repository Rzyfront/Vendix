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

// Categoría padre para el breadcrumb (se renderiza como "Categoría / Título" encima del título)
const routeBreadcrumbCategory: Record<string, string> = {
  dashboard: 'Panel Administrativo',
  pos: 'Tienda',
  products: 'Tienda',
  orders: 'Tienda',
  inventory: 'Tienda',
  pop: 'Inventario',
  purchase: 'Inventario',
  adjustments: 'Inventario',
  transfers: 'Inventario',
  movements: 'Inventario',
  suppliers: 'Inventario',
  locations: 'Inventario',
  customers: 'Tienda',
  invoicing: 'Tienda',
  accounting: 'Tienda',
  expenses: 'Tienda',
  analytics: 'Tienda',
  online_store: 'Tienda',
  marketing: 'Tienda',
  settings: 'Tienda',
  help: 'Tienda',
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
  const category = routeBreadcrumbCategory[currentSegment];
  const breadcrumb = category ? `${category} / ${title}` : undefined;

  return (
    <AdminShell title={title} breadcrumb={breadcrumb} variant="store">
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
