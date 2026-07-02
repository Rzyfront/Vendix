// ─────────────────────────────────────────────
// SalesView — catálogo de vistas del módulo Ventas
//
// Paridad con apps/frontend (sales-by-product.component.html → grid de
// <app-analytics-card>) y con apps/mobile (AnalyticsViewsCard).
//
// Cada entrada describe una vista del módulo Ventas:
//   - key:        identificador estable (usado en routes y query keys)
//   - title:      título mostrado en cards y tabs
//   - description: copy corto debajo del título
//   - icon:       nombre del icono (string) — el componente hace el cast
//   - route:      ruta expo-router a la que navega si está disponible
//   - available:  false → muestra toast "Próximamente" en vez de navegar
//   - color:      paleta bg/fg para el icono y el badge de la card
//
// Esta fuente es la única verdad: si se agregan vistas nuevas al módulo
// Ventas, basta con añadirlas aquí y AnalyticsViewsCard / ScrollableTabs
// las recogerán automáticamente vía `getQuickLinks(excludeKey)`.
// ─────────────────────────────────────────────

import { colorScales } from '@/shared/theme';

export interface SalesView {
  key:
    | 'sales_summary'
    | 'sales_by_product'
    | 'sales_by_category'
    | 'sales_by_customer'
    | 'sales_by_payment';
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
    description: 'KPIs globales del período',
    icon: 'line-chart',
    route: '/analytics/sales',
    available: true,
    color: { bg: colorScales.blue[100], fg: colorScales.blue[600] },
  },
  {
    key: 'sales_by_product',
    title: 'Ventas por Producto',
    description: 'Productos más vendidos',
    icon: 'package',
    route: '/analytics/sales/by-product',
    available: true,
    color: { bg: colorScales.purple[100], fg: colorScales.purple[600] },
  },
  {
    key: 'sales_by_category',
    title: 'Ventas por Categoría',
    description: 'Mix de categorías vendidas',
    icon: 'folder',
    route: '/analytics/sales/by-category',
    available: false,
    color: { bg: colorScales.amber[100], fg: colorScales.amber[600] },
  },
  {
    key: 'sales_by_customer',
    title: 'Ventas por Cliente',
    description: 'Top clientes del período',
    icon: 'users',
    route: '/analytics/sales/by-customer',
    available: false,
    color: { bg: colorScales.green[100], fg: colorScales.green[600] },
  },
  {
    key: 'sales_by_payment',
    title: 'Ventas por Método de Pago',
    description: 'Mix de pagos recibidos',
    icon: 'credit-card',
    route: '/analytics/sales/by-payment',
    available: false,
    color: { bg: colorScales.red[100], fg: colorScales.red[600] },
  },
];

/**
 * Devuelve las vistas complementarias a la actual, listas para alimentar
 * `<AnalyticsViewsCard />`. Excluye `excludeKey` (la vista actual) y
 * devuelve solo las entradas disponibles — comportamiento equivalente al
 * web `getQuickLinks()` de sales-by-product.component.ts.
 *
 * Si en el futuro se quieren mostrar también las no disponibles con badge
 * "Próximamente", basta con cambiar el `.filter((v) => v.available)` por
 * `.filter((v) => v.key !== excludeKey)`.
 */
export function getQuickLinks(
  excludeKey: SalesView['key'],
): SalesView[] {
  return SALES_VIEWS.filter((v) => v.key !== excludeKey && v.available);
}