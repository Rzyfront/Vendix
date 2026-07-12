import { colorScales } from '@/shared/theme';

// ─────────────────────────────────────────────
// Sales Views Registry — paridad con web
//
// Fuente única de verdad para las vistas de analytics de ventas
// usadas por el tab menu horizontal y por el card "Vistas de Ventas"
// al final de cada vista (paridad con apps/frontend analytics-registry.ts
// → ANALYTICS_VIEWS filtrado por category='sales').
//
// Para mantener paridad visual con la web, los íconos usan los nombres
// reales de lucide-react. La capa de presentación (Icon component en
// shared) los mapea a los componentes de lucide-react-native disponibles.
// ─────────────────────────────────────────────

export interface SalesView {
  key: string;
  title: string;
  description: string;
  icon: string;
  route: string;
  available: boolean;
  color: { bg: string; fg: string };
}

export const SALES_VIEWS: SalesView[] = [
  {
    key: 'sales_summary',
    title: 'Resumen de Ventas',
    description: 'Ingresos totales y KPIs',
    icon: 'bar-chart-3',
    route: '/analytics/sales',
    available: true,
    color: { bg: colorScales.green[50], fg: colorScales.green[600] },
  },
  {
    key: 'sales_by_product',
    title: 'Por Producto',
    description: 'Ranking de más vendidos',
    icon: 'package',
    route: '/analytics/sales/by-product',
    available: true,
    color: { bg: colorScales.blue[50], fg: colorScales.blue[600] },
  },
  {
    key: 'sales_by_category',
    title: 'Por Categoría',
    description: 'Distribución por categoría',
    icon: 'tags',
    route: '/analytics/sales/by-category',
    available: true,
    color: { bg: colorScales.purple[50], fg: colorScales.purple[600] },
  },
  {
    key: 'sales_trends',
    title: 'Tendencias',
    description: 'Evolución temporal',
    icon: 'activity',
    route: '/analytics/sales/trends',
    available: true,
    color: { bg: colorScales.orange[50], fg: colorScales.orange[600] },
  },
  {
    key: 'sales_by_customer',
    title: 'Por Cliente',
    description: 'Top clientes por volumen',
    icon: 'users-round',
    route: '/analytics/sales/by-customer',
    available: true,
    color: { bg: colorScales.amber[50], fg: colorScales.amber[600] },
  },
  {
    key: 'sales_by_payment',
    title: 'Por Método de Pago',
    description: 'Distribución por forma de pago',
    icon: 'credit-card',
    route: '/analytics/sales/by-payment',
    available: true,
    color: { bg: colorScales.red[50], fg: colorScales.red[600] },
  },
];

export type SalesViewKey = SalesView['key'];

/**
 * Devuelve la lista de vistas que se muestran en el card "Vistas de Ventas"
 * al final de cada pantalla, excluyendo la vista actual (paridad web:
 * `getViewsByCategory('sales').filter(v => v.key !== <current_key>)`).
 */
export function getQuickLinks(excludeKey: SalesViewKey): SalesView[] {
  return SALES_VIEWS.filter((v) => v.key !== excludeKey);
}
