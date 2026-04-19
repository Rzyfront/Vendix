/**
 * Analytics Registry - Central configuration for all analytics views and categories.
 *
 * Single source of truth for:
 * - Sidebar tabs per module
 * - Analytics catalog in the Overview page
 * - Breadcrumb generation
 * - Panel UI visibility mapping
 *
 * To add a new analytics view:
 * 1. Add entry to ANALYTICS_VIEWS array
 * 2. Add child route in analytics.routes.ts
 * 3. No other files need modification
 */

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type AnalyticsCategoryId =
  | 'overview'
  | 'sales'
  | 'inventory'
  | 'products'
  | 'purchases'
  | 'customers'
  | 'reviews'
  | 'financial';

export interface AnalyticsCategory {
  id: AnalyticsCategoryId;
  label: string;
  description: string;
  icon: string;
  color: string;
  panelUiKey: string;
}

export interface AnalyticsView {
  key: string;
  title: string;
  description: string;
  detailedDescription?: string;
  route: string;
  category: AnalyticsCategoryId;
  icon: string;
  comingSoon?: boolean;
}

// ─────────────────────────────────────────────
// Categories (8 total)
// ─────────────────────────────────────────────

export const ANALYTICS_CATEGORIES: AnalyticsCategory[] = [
  {
    id: 'overview',
    label: 'Resumen',
    description: 'Vista general del negocio',
    icon: 'layout-dashboard',
    color: 'var(--color-primary)',
    panelUiKey: 'analytics_overview',
  },
  {
    id: 'sales',
    label: 'Ventas',
    description: 'Análisis de ingresos y tendencias',
    icon: 'trending-up',
    color: 'var(--color-success)',
    panelUiKey: 'analytics_sales',
  },
  {
    id: 'inventory',
    label: 'Inventario',
    description: 'Stock, movimientos y valoracion',
    icon: 'package',
    color: 'var(--color-warning)',
    panelUiKey: 'analytics_inventory',
  },
  {
    id: 'products',
    label: 'Productos',
    description: 'Rendimiento y rentabilidad',
    icon: 'box',
    color: 'var(--color-info)',
    panelUiKey: 'analytics_products',
  },
  {
    id: 'purchases',
    label: 'Compras',
    description: 'Ordenes de compra y proveedores',
    icon: 'shopping-cart',
    color: 'var(--color-secondary)',
    panelUiKey: 'analytics_purchases',
  },
  {
    id: 'customers',
    label: 'Clientes',
    description: 'Adquisicion y comportamiento',
    icon: 'users',
    color: '#8b5cf6',
    panelUiKey: 'analytics_customers',
  },
  {
    id: 'reviews',
    label: 'Reseñas',
    description: 'Opiniones y valoraciones',
    icon: 'message-square',
    color: '#ec4899',
    panelUiKey: 'analytics_reviews',
  },
  {
    id: 'financial',
    label: 'Financiero',
    description: 'Estado de resultados e impuestos',
    icon: 'landmark',
    color: 'var(--color-text-primary)',
    panelUiKey: 'analytics_financial',
  },
];

// ─────────────────────────────────────────────
// Views (27 total)
// ─────────────────────────────────────────────

export const ANALYTICS_VIEWS: AnalyticsView[] = [
  // Overview (1)
  {
    key: 'overview_summary',
    title: 'Resumen General',
    description: 'Metricas clave del negocio en un solo vistazo',
    detailedDescription: 'Visualiza los indicadores mas importantes de tu negocio: ingresos, gastos, impuestos y ganancia neta.',
    route: '/admin/analytics/overview',
    category: 'overview',
    icon: 'layout-dashboard',
  },

  // Sales (6)
  {
    key: 'sales_summary',
    title: 'Resumen de Ventas',
    description: 'Ingresos totales, comparativas y KPIs principales',
    detailedDescription: 'Analiza el rendimiento de ventas con metricas de evolucion, comparativas por periodo y participacion.',
    route: '/admin/analytics/sales/summary',
    category: 'sales',
    icon: 'bar-chart-3',
  },
  {
    key: 'sales_by_product',
    title: 'Por Producto',
    description: 'Ranking de productos mas vendidos y su contribucion',
    detailedDescription: 'Descubre que productos estan generando mas receita y cual es su participacion en las ventas totales.',
    route: '/admin/analytics/sales/by-product',
    category: 'sales',
    icon: 'package',
  },
  {
    key: 'sales_by_category',
    title: 'Por Categoria',
    description: 'Distribucion de ventas por categoria de producto',
    detailedDescription: 'Compara el rendimiento de ventas entre categorias para identificar oportunidades de crecimiento.',
    route: '/admin/analytics/sales/by-category',
    category: 'sales',
    icon: 'tags',
  },
  {
    key: 'sales_trends',
    title: 'Tendencias',
    description: 'Evolucion temporal de ventas con analisis de patrones',
    detailedDescription: 'Identifica patrones estacionales y tendencias para planificar inventario y estrategias comerciales.',
    route: '/admin/analytics/sales/trends',
    category: 'sales',
    icon: 'activity',
  },
  {
    key: 'sales_by_customer',
    title: 'Por Cliente',
    description: 'Top clientes por volumen de compra y frecuencia',
    detailedDescription: 'Conoce a tus mejores clientes, su volumen de compra y frecuencia para estrategias de retencion.',
    route: '/admin/analytics/sales/by-customer',
    category: 'sales',
    icon: 'user-round',
  },
  {
    key: 'sales_by_payment',
    title: 'Por Metodo de Pago',
    description: 'Distribucion de ventas segun forma de pago',
    detailedDescription: 'Analiza quais metodos de pago seus clientes preferem usar no checkout.',
    route: '/admin/analytics/sales/by-payment',
    category: 'sales',
    icon: 'credit-card',
  },

  // Inventory (5)
  {
    key: 'inventory_overview',
    title: 'Resumen de Inventario',
    description: 'Estado general del stock y alertas',
    detailedDescription: 'Vista consolidada del estado de tu inventario con alertas de stock bajo y en surplus.',
    route: '/admin/analytics/inventory/overview',
    category: 'inventory',
    icon: 'package-search',
  },
  {
    key: 'inventory_stock_info',
    title: 'Info de Stock',
    description: 'Niveles de stock por ubicacion y producto',
    detailedDescription: 'Consulta niveles de inventario detallados por producto, ubicacion y almacen.',
    route: '/admin/analytics/inventory/stock-info',
    category: 'inventory',
    icon: 'warehouse',
  },
  {
    key: 'inventory_movements',
    title: 'Movimientos',
    description: 'Historial de entradas y salidas de inventario',
    detailedDescription: 'Revisa el historial completo de movimientos de inventario con filtros por tipo y fecha.',
    route: '/admin/analytics/inventory/movements',
    category: 'inventory',
    icon: 'arrow-left-right',
  },
  {
    key: 'inventory_valuation',
    title: 'Valoracion',
    description: 'Valor total del inventario por metodo contable',
    detailedDescription: 'Calcula el valor de tu inventario usando diferentes métodos de valoracion contable.',
    route: '/admin/analytics/inventory/valuation',
    category: 'inventory',
    icon: 'calculator',
  },
  {
    key: 'inventory_movement_analysis',
    title: 'Analisis de Movimientos',
    description: 'Patrones y tendencias en movimientos de stock',
    detailedDescription: 'Analiza patrones de movimiento de inventario para optimizar reposicion y evitar faltantes.',
    route: '/admin/analytics/inventory/movement-analysis',
    category: 'inventory',
    icon: 'line-chart',
  },

  // Products (3)
  {
    key: 'products_performance',
    title: 'Rendimiento',
    description: 'Metricas de rendimiento por producto',
    detailedDescription: 'Evalua el desempeño de cada producto con metricas de ventas, margen y rotacion.',
    route: '/admin/analytics/products/performance',
    category: 'products',
    icon: 'zap',
  },
  {
    key: 'products_top_sellers',
    title: 'Top Sellers',
    description: 'Productos mas vendidos del periodo',
    detailedDescription: 'Identifica los productos estrella que generan mayor volumen de ventas.',
    route: '/admin/analytics/products/top-sellers',
    category: 'products',
    icon: 'trophy',
  },
  {
    key: 'products_profitability',
    title: 'Rentabilidad',
    description: 'Margen de ganancia por producto y categoria',
    detailedDescription: 'Analiza el margen de ganancia real por producto considerando costos y gastos asociados.',
    route: '/admin/analytics/products/profitability',
    category: 'products',
    icon: 'coins',
  },

  // Purchases (2)
  {
    key: 'purchases_summary',
    title: 'Resumen de Compras',
    description: 'Ordenes de compra y gastos en proveedores',
    detailedDescription: 'Consolida todas tus ordenes de compra y analiza el gasto por proveedor y periodo.',
    route: '/admin/analytics/purchases/summary',
    category: 'purchases',
    icon: 'receipt',
  },
  {
    key: 'purchases_by_supplier',
    title: 'Por Proveedor',
    description: 'Analisis de compras por proveedor',
    detailedDescription: 'Compara el volumen de compras entre proveedores para negociar mejores condiciones.',
    route: '/admin/analytics/purchases/by-supplier',
    category: 'purchases',
    icon: 'truck',
  },

  // Customers (3)
  {
    key: 'customers_summary',
    title: 'Resumen de Clientes',
    description: 'Base de clientes y metricas principales',
    detailedDescription: 'Ten una vision completa de tu base de clientes con metricas de crecimiento y actividad.',
    route: '/admin/analytics/customers/summary',
    category: 'customers',
    icon: 'users',
  },
  {
    key: 'customers_acquisition',
    title: 'Adquisicion',
    description: 'Nuevos clientes y canales de adquisicion',
    detailedDescription: 'Rastrea nuevos clientes e identifica quais canais estao trazendo mais conversoes.',
    route: '/admin/analytics/customers/acquisition',
    category: 'customers',
    icon: 'user-plus',
  },
  {
    key: 'customers_abandoned_carts',
    title: 'Carritos Abandonados',
    description: 'Tasa de abandono y recuperacion de carritos',
    detailedDescription: 'Analiza la tasa de abandono de carritos y recupera ventas potenciales con campañas automatizadas.',
    route: '/admin/analytics/customers/abandoned-carts',
    category: 'customers',
    icon: 'shopping-cart',
  },

  // Reviews (1)
  {
    key: 'reviews_summary',
    title: 'Resumen de Reseñas',
    description: 'Opiniones, valoraciones y satisfaccion del cliente',
    detailedDescription: 'Monitorea las resenas de tus clientes para mejorar productos y atencion al cliente.',
    route: '/admin/analytics/reviews/summary',
    category: 'reviews',
    icon: 'message-square',
  },

  // Financial (3)
  {
    key: 'financial_profit_loss',
    title: 'Estado de Resultados',
    description: 'Ingresos, costos y utilidad neta del periodo',
    detailedDescription: 'Genera estados de resultados para analizar la rentabilidad de tu negocio por periodo.',
    route: '/admin/analytics/financial/profit-loss',
    category: 'financial',
    icon: 'landmark',
  },
  {
    key: 'financial_tax_summary',
    title: 'Resumen de Impuestos',
    description: 'Desglose de impuestos recaudados y pagados',
    detailedDescription: 'Ten claridad sobre tus obligaciones tributarias con reportes detallados de impuestos.',
    route: '/admin/analytics/financial/tax-summary',
    category: 'financial',
    icon: 'file-text',
  },
  {
    key: 'financial_refunds',
    title: 'Reembolsos',
    description: 'Devoluciones y reembolsos procesados',
    detailedDescription: 'Controla las devoluciones y reembolsos para identificar problemas de calidad o servicio.',
    route: '/admin/analytics/financial/refunds',
    category: 'financial',
    icon: 'rotate-ccw',
  },
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export function getViewsByCategory(categoryId: AnalyticsCategoryId): AnalyticsView[] {
  return ANALYTICS_VIEWS.filter((v) => v.category === categoryId);
}

export function getCategoryById(id: AnalyticsCategoryId): AnalyticsCategory | undefined {
  return ANALYTICS_CATEGORIES.find((c) => c.id === id);
}

export function getViewByKey(key: string): AnalyticsView | undefined {
  return ANALYTICS_VIEWS.find((v) => v.key === key);
}

export function getDefaultViewForCategory(categoryId: AnalyticsCategoryId): AnalyticsView | undefined {
  return getViewsByCategory(categoryId)[0];
}

export function getSidebarEntries(): {
  label: string;
  route: string;
  icon: string;
  panelUiKey: string;
  viewCount: number;
}[] {
  return ANALYTICS_CATEGORIES.map((cat) => ({
    label: cat.label,
    route: getDefaultViewForCategory(cat.id)?.route ?? `/admin/analytics/${cat.id}`,
    icon: cat.icon,
    panelUiKey: cat.panelUiKey,
    viewCount: getViewsByCategory(cat.id).length,
  }));
}
