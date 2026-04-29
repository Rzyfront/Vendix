import { useEffect } from 'react';
import { Slot, useRouter, usePathname } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AdminShell } from '@/shared/layouts/admin-shell';
import { useAuthStore } from '@/core/store/auth.store';
import { colors } from '@/shared/theme';

const routeTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  pos: 'Punto de Venta',
  products: 'Productos',
  orders: 'Órdenes',
  inventory: 'Inventario',
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

  return (
    <AdminShell title={title} variant="store">
      <Slot />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
