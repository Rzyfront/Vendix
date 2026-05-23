import { ReportCategory, ReportCategoryId, ReportDefinition, ReportType } from '../interfaces/report.interface';

export const REPORT_CATEGORIES: ReportCategory[] = [
  { id: 'overview', label: 'Resumen', description: 'Reporte general consolidado del negocio', icon: 'layout-dashboard', color: 'var(--color-primary)' },
  { id: 'sales', label: 'Ventas', description: 'Reportes de ventas y facturacion', icon: 'shopping-cart', color: 'var(--color-primary)' },
  { id: 'inventory', label: 'Inventario', description: 'Reportes de stock y movimientos', icon: 'warehouse', color: 'var(--color-warning)' },
  { id: 'products', label: 'Productos', description: 'Reportes de rendimiento y rentabilidad', icon: 'package', color: 'var(--color-accent)' },
  { id: 'customers', label: 'Clientes', description: 'Reportes de cartera y cuentas por cobrar', icon: 'users', color: 'var(--color-info)' },
  { id: 'purchases', label: 'Compras', description: 'Reportes de ordenes de compra y proveedores', icon: 'truck', color: 'var(--color-warning)' },
  { id: 'reviews', label: 'Reseñas', description: 'Reportes de reseñas y satisfaccion de clientes', icon: 'star', color: 'var(--color-accent)' },
  { id: 'accounting', label: 'Contabilidad', description: 'Reportes contables y financieros', icon: 'book-open', color: 'var(--color-secondary)' },
  { id: 'payroll', label: 'Nomina', description: 'Reportes de nomina y provisiones', icon: 'banknote', color: 'var(--color-success)' },
  { id: 'financial', label: 'Financiero', description: 'Reportes financieros y de caja', icon: 'wallet', color: 'var(--color-destructive)' },
];

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  // ─── RESUMEN (1) ─────────────────────────────────────────────────────────────────

  {
    id: 'overview-summary',
    category: 'overview',
    title: 'Resumen General',
    description: 'Vista consolidada de ventas, inventario y clientes',
    detailedDescription: 'Reporte general que consolida las metricas principales del negocio: ventas totales, estado de inventario, clientes activos y indicadores clave de rendimiento.',
    icon: 'layout-dashboard',
    route: '/admin/reports/overview/overview-summary',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'summary' as ReportType,
    summaryLayout: {
      fields: [
        { key: 'total_revenue', label: 'Ventas Totales', type: 'currency' },
        { key: 'total_orders', label: 'Total Ordenes', type: 'number' },
        { key: 'total_products', label: 'Productos Activos', type: 'number' },
        { key: 'total_customers', label: 'Clientes Activos', type: 'number' },
        { key: 'low_stock_count', label: 'Productos Bajo Stock', type: 'number' },
        { key: 'inventory_value', label: 'Valor Inventario', type: 'currency' },
      ],
    },
    columns: [],
    exportFilename: 'resumen-general',
    dataEndpoint: 'store/analytics/overview/summary',
  },

  // ─── COMPRAS (3) ─────────────────────────────────────────────────────────────────

  {
    id: 'purchase-summary',
    category: 'purchases',
    title: 'Resumen de Compras',
    description: 'Totales de ordenes de compra y proveedores del periodo',
    detailedDescription: 'Reporte consolidado de todas las ordenes de compra realizadas, incluyendo total comprado, cantidad de ordenes, proveedores principales y comparativa con periodos anteriores.',
    icon: 'truck',
    route: '/admin/reports/purchases/purchase-summary',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'summary' as ReportType,
    summaryLayout: {
      fields: [
        { key: 'total_purchases', label: 'Total Compras', type: 'currency' },
        { key: 'total_orders', label: 'Total Ordenes', type: 'number' },
        { key: 'total_suppliers', label: 'Proveedores Activos', type: 'number' },
        { key: 'average_order_value', label: 'Ticket Promedio', type: 'currency' },
      ],
    },
    columns: [
      { key: 'supplier_name', header: 'Proveedor', type: 'text' },
      { key: 'order_count', header: 'Ordenes', type: 'number', footer: 'sum' },
      { key: 'total_amount', header: 'Total', type: 'currency', footer: 'sum' },
      { key: 'status', header: 'Estado', type: 'text' },
      { key: 'last_order_date', header: 'Ultima Orden', type: 'date' },
    ],
    exportFilename: 'resumen-compras',
    dataEndpoint: 'store/analytics/purchases/summary',
  },
  {
    id: 'purchase-by-supplier',
    category: 'purchases',
    title: 'Compras por Proveedor',
    description: 'Desglose de compras agrupadas por proveedor',
    detailedDescription: 'Analisis detallado de las compras realizadas a cada proveedor, mostrando volumen, frecuencia y montos para evaluar relaciones comerciales.',
    icon: 'building-2',
    route: '/admin/reports/purchases/purchase-by-supplier',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'supplier_name', header: 'Proveedor', type: 'text' },
      { key: 'order_count', header: 'Ordenes', type: 'number', footer: 'sum' },
      { key: 'total_amount', header: 'Total Comprado', type: 'currency', footer: 'sum' },
      { key: 'average_amount', header: 'Promedio', type: 'currency' },
      { key: 'products_count', header: 'Productos', type: 'number' },
      { key: 'last_order', header: 'Ultima Orden', type: 'date' },
    ],
    exportFilename: 'compras-por-proveedor',
    dataEndpoint: 'store/analytics/purchases/by-supplier',
  },
  {
    id: 'purchase-trends',
    category: 'purchases',
    title: 'Tendencias de Compras',
    description: 'Evolucion de compras en el tiempo',
    detailedDescription: 'Analisis de tendencias de compras a lo largo del tiempo, identificando patrones estacionales, variaciones y proyecciones para planificacion de aprovisionamiento.',
    icon: 'trending-up',
    route: '/admin/reports/purchases/purchase-trends',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'period', header: 'Periodo', type: 'text' },
      { key: 'total_purchases', header: 'Total Compras', type: 'currency', footer: 'sum' },
      { key: 'order_count', header: 'Ordenes', type: 'number', footer: 'sum' },
      { key: 'unique_suppliers', header: 'Proveedores', type: 'number' },
      { key: 'growth', header: 'Crecimiento', type: 'percentage' },
    ],
    exportFilename: 'tendencias-compras',
    dataEndpoint: 'store/analytics/purchases/trends',
  },

  // ─── RESEÑAS (2) ──────────────────────────────────────────────────────────────────

  {
    id: 'reviews-summary',
    category: 'reviews',
    title: 'Resumen de Reseñas',
    description: 'Calificacion promedio y distribucion de reseñas',
    detailedDescription: 'Reporte consolidado de las reseñas recibidas, incluyendo calificacion promedio, distribucion por estrellas, productos mejor valorados y tendencias de satisfaccion.',
    icon: 'star',
    route: '/admin/reports/reviews/reviews-summary',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'summary' as ReportType,
    summaryLayout: {
      fields: [
        { key: 'average_rating', label: 'Calificacion Promedio', type: 'number' },
        { key: 'total_reviews', label: 'Total Reseñas', type: 'number' },
        { key: 'five_star_count', label: '5 Estrellas', type: 'number' },
        { key: 'one_star_count', label: '1 Estrella', type: 'number' },
        { key: 'response_rate', label: 'Tasa de Respuesta', type: 'percentage' },
      ],
    },
    columns: [],
    exportFilename: 'resumen-resenas',
    dataEndpoint: 'store/analytics/reviews/summary',
  },
  {
    id: 'reviews-by-product',
    category: 'reviews',
    title: 'Reseñas por Producto',
    description: 'Reseñas detalladas agrupadas por producto',
    detailedDescription: 'Listado de productos con sus reseñas, calificacion promedio, cantidad de reseñas y comentarios mas recientes para identificar oportunidades de mejora.',
    icon: 'message-square',
    route: '/admin/reports/reviews/reviews-by-product',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'average_rating', header: 'Calificacion', type: 'number' },
      { key: 'review_count', header: 'Reseñas', type: 'number', footer: 'sum' },
      { key: 'five_star_pct', header: '5 Estrellas %', type: 'percentage' },
      { key: 'latest_review', header: 'Ultima Reseña', type: 'date' },
    ],
    exportFilename: 'resenas-por-producto',
    dataEndpoint: 'store/analytics/reviews/by-product',
  },

  // ─── VENTAS (7) ───────────────────────────────────────────────────────────────

  {
    id: 'sales-summary',
    category: 'sales',
    title: 'Resumen de Ventas',
    description: 'Totales de ventas, promedios y ticket promedio del periodo',
    detailedDescription:
      'Visualiza un resumen completo de las ventas del periodo seleccionado, incluyendo total facturado, cantidad de ordenes, ticket promedio, descuentos aplicados y comparativa con periodo anterior.',
    icon: 'bar-chart-3',
    route: '/admin/reports/sales/sales-summary',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'summary' as ReportType,
    summaryLayout: {
      fields: [
        { key: 'total_revenue', label: 'Ventas Totales', type: 'currency' },
        { key: 'total_orders', label: 'Total Pedidos', type: 'number' },
        { key: 'average_order_value', label: 'Ticket Promedio', type: 'currency' },
        { key: 'total_units_sold', label: 'Productos Vendidos', type: 'number' },
        { key: 'total_customers', label: 'Clientes Unicos', type: 'number' },
        { key: 'revenue_growth', label: 'Crecimiento Ingresos', type: 'percentage' },
        { key: 'orders_growth', label: 'Crecimiento Ordenes', type: 'percentage' },
      ],
    },
    columns: [
      { key: 'period', header: 'Periodo', type: 'text' },
      { key: 'total_sales', header: 'Total Ventas', type: 'currency', footer: 'sum' },
      { key: 'order_count', header: 'Cantidad Ordenes', type: 'number', footer: 'sum' },
      { key: 'avg_ticket', header: 'Ticket Promedio', type: 'currency', footer: 'average' },
      { key: 'discount_amount', header: 'Descuentos', type: 'currency', footer: 'sum' },
    ],
    exportFilename: 'sales_summary',
    dataEndpoint: 'store/analytics/sales/summary',
    exportEndpoint: 'store/analytics/sales/export',
  },

  {
    id: 'sales-by-product',
    category: 'sales',
    title: 'Ventas por Producto',
    description: 'Ranking de productos vendidos con cantidades y montos',
    detailedDescription:
      'Identifica tus productos estrella con un ranking detallado por cantidad vendida e ingreso generado. Incluye margen de ganancia por producto.',
    icon: 'package-search',
    route: '/admin/reports/sales/sales-by-product',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'product_id',
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'units_sold', header: 'Cantidad Vendida', type: 'number', footer: 'sum' },
      { key: 'revenue', header: 'Ingreso Total', type: 'currency', footer: 'sum' },
      { key: 'average_price', header: 'Precio Promedio', type: 'currency', footer: 'average' },
      { key: 'profit_margin', header: 'Margen', type: 'percentage', footer: 'average' },
    ],
    exportFilename: 'sales_by_product',
    dataEndpoint: 'store/analytics/sales/by-product',
  },

  {
    id: 'sales-by-category',
    category: 'sales',
    title: 'Ventas por Categoria',
    description: 'Desglose de ventas por categoria de producto',
    detailedDescription:
      'Analiza que categorias de productos generan mas ingresos. Util para decisiones de inventario y marketing.',
    icon: 'tags',
    route: '/admin/reports/sales/sales-by-category',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'category_id',
    columns: [
      { key: 'category_name', header: 'Categoria', type: 'text' },
      { key: 'units_sold', header: 'Unidades Vendidas', type: 'number', footer: 'sum' },
      { key: 'revenue', header: 'Total Ventas', type: 'currency', footer: 'sum' },
      { key: 'percentage_of_total', header: 'Participacion', type: 'percentage' },
    ],
    exportFilename: 'sales_by_category',
    dataEndpoint: 'store/analytics/sales/by-category',
  },

  {
    id: 'sales-by-customer',
    category: 'sales',
    title: 'Ventas por Cliente',
    description: 'Clientes con mayor facturacion en el periodo',
    detailedDescription:
      'Descubre quienes son tus mejores clientes por volumen de compra. Incluye frecuencia de compra y ticket promedio por cliente.',
    icon: 'user-check',
    route: '/admin/reports/sales/sales-by-customer',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'customer_id',
    columns: [
      { key: 'customer_name', header: 'Cliente', type: 'text' },
      { key: 'total_spent', header: 'Total Compras', type: 'currency', footer: 'sum' },
      { key: 'total_orders', header: 'Cantidad Ordenes', type: 'number', footer: 'sum' },
      { key: 'average_order_value', header: 'Ticket Promedio', type: 'currency', footer: 'average' },
      { key: 'last_order_date', header: 'Ultima Compra', type: 'date' },
    ],
    exportFilename: 'sales_by_customer',
    dataEndpoint: 'store/analytics/sales/by-customer',
  },

  {
    id: 'sales-by-payment',
    category: 'sales',
    title: 'Ventas por Metodo de Pago',
    description: 'Distribucion por efectivo, tarjeta, transferencia, etc.',
    detailedDescription:
      'Conoce como prefieren pagar tus clientes. Desglose por metodo de pago con porcentaje de participacion y montos.',
    icon: 'credit-card',
    route: '/admin/reports/sales/sales-by-payment',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'payment_method',
    columns: [
      { key: 'payment_method', header: 'Metodo de Pago', type: 'text' },
      { key: 'display_name', header: 'Nombre', type: 'text' },
      { key: 'total_amount', header: 'Monto Total', type: 'currency', footer: 'sum' },
      { key: 'transaction_count', header: 'Transacciones', type: 'number', footer: 'sum' },
      { key: 'percentage', header: 'Participacion', type: 'percentage' },
    ],
    exportFilename: 'sales_by_payment',
    dataEndpoint: 'store/analytics/sales/by-payment-method',
  },

  {
    id: 'sales-by-channel',
    category: 'sales',
    title: 'Ventas por Canal',
    description: 'POS vs ecommerce vs otros canales de venta',
    detailedDescription:
      'Compara el rendimiento de tus canales de venta: punto de venta fisico, tienda en linea y otros. Identifica oportunidades de crecimiento.',
    icon: 'store',
    route: '/admin/reports/sales/sales-by-channel',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'channel',
    columns: [
      { key: 'display_name', header: 'Canal', type: 'text' },
      { key: 'revenue', header: 'Total Ventas', type: 'currency', footer: 'sum' },
      { key: 'order_count', header: 'Cantidad Ordenes', type: 'number', footer: 'sum' },
      { key: 'percentage', header: 'Participacion', type: 'percentage' },
    ],
    exportFilename: 'sales_by_channel',
    dataEndpoint: 'store/analytics/sales/by-channel',
  },

  {
    id: 'sales-trends',
    category: 'sales',
    title: 'Tendencias de Ventas',
    description: 'Evolucion temporal de ventas (diario/semanal/mensual)',
    detailedDescription:
      'Observa como evolucionan tus ventas en el tiempo. Detecta patrones estacionales, dias de mayor venta y tendencias de crecimiento.',
    icon: 'trending-up',
    route: '/admin/reports/sales/sales-trends',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    keyMapping: { period: 'date', revenue: 'total_sales', orders: 'order_count', average_order_value: 'avg_ticket' },
    trackKey: 'period',
    columns: [
      { key: 'date', header: 'Fecha', type: 'date' },
      { key: 'total_sales', header: 'Total Ventas', type: 'currency', footer: 'sum' },
      { key: 'order_count', header: 'Cantidad Ordenes', type: 'number', footer: 'sum' },
      { key: 'avg_ticket', header: 'Ticket Promedio', type: 'currency', footer: 'average' },
    ],
    exportFilename: 'sales_trends',
    dataEndpoint: 'store/analytics/sales/trends',
  },

  // ─── INVENTARIO (5) ──────────────────────────────────────────────────────────

  {
    id: 'inventory-valuation',
    category: 'inventory',
    title: 'Valoracion de Inventario',
    description: 'Valor total del inventario por costo y precio de venta',
    detailedDescription:
      'Calcula el valor total de tu inventario actual, tanto a precio de costo como a precio de venta. Incluye desglose por ubicacion y categoria.',
    icon: 'calculator',
    route: '/admin/reports/inventory/inventory-valuation',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'location_id',
    columns: [
      { key: 'location_name', header: 'Ubicacion', type: 'text' },
      { key: 'total_quantity', header: 'Cantidad Total', type: 'number', footer: 'sum' },
      { key: 'average_cost', header: 'Costo Promedio', type: 'currency', footer: 'average' },
      { key: 'total_value', header: 'Valor Total', type: 'currency', footer: 'sum' },
      { key: 'percentage_of_total', header: 'Participacion', type: 'percentage' },
    ],
    exportFilename: 'inventory_valuation',
    dataEndpoint: 'store/analytics/inventory/valuation',
  },

  {
    id: 'inventory-stock-levels',
    category: 'inventory',
    title: 'Niveles de Stock',
    description: 'Estado actual de stock por producto y ubicacion',
    detailedDescription:
      'Revisa el estado actual del inventario con detalle por producto y ubicacion. Incluye stock disponible, reservado y punto de reorden.',
    icon: 'layers',
    route: '/admin/reports/inventory/inventory-stock-levels',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'product_id',
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'sku', header: 'SKU', type: 'text' },
      { key: 'quantity_on_hand', header: 'En Mano', type: 'number', footer: 'sum' },
      { key: 'quantity_reserved', header: 'Reservado', type: 'number', footer: 'sum' },
      { key: 'quantity_available', header: 'Disponible', type: 'number', footer: 'sum' },
      { key: 'reorder_point', header: 'Punto de Reorden', type: 'number' },
      { key: 'status', header: 'Estado', type: 'text' },
    ],
    exportFilename: 'inventory_stock_levels',
    dataEndpoint: 'store/analytics/inventory/stock-levels',
  },

  {
    id: 'inventory-low-stock',
    category: 'inventory',
    title: 'Productos con Bajo Stock',
    description: 'Productos por debajo del punto de reorden',
    detailedDescription:
      'Alertas de productos que necesitan reabastecimiento. Muestra los productos cuyo stock disponible esta por debajo del punto de reorden configurado.',
    icon: 'alert-triangle',
    route: '/admin/reports/inventory/inventory-low-stock',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'product_id',
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'sku', header: 'SKU', type: 'text' },
      { key: 'quantity_available', header: 'Stock Actual', type: 'number' },
      { key: 'reorder_point', header: 'Punto de Reorden', type: 'number' },
      { key: 'status', header: 'Estado', type: 'text' },
    ],
    exportFilename: 'inventory_low_stock',
    dataEndpoint: 'store/analytics/inventory/low-stock',
  },

  {
    id: 'inventory-movements',
    category: 'inventory',
    title: 'Movimientos de Inventario',
    description: 'Entradas, salidas, ajustes y transferencias del periodo',
    detailedDescription:
      'Rastrea todos los movimientos de inventario: compras, ventas, ajustes manuales y transferencias entre ubicaciones. Ideal para auditorias.',
    icon: 'arrow-left-right',
    route: '/admin/reports/inventory/inventory-movements',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'id',
    columns: [
      { key: 'date', header: 'Fecha', type: 'date' },
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'movement_type', header: 'Tipo', type: 'text' },
      { key: 'quantity', header: 'Cantidad', type: 'number', footer: 'sum' },
      { key: 'from_location', header: 'Desde', type: 'text' },
      { key: 'to_location', header: 'Hacia', type: 'text' },
      { key: 'reason', header: 'Razon', type: 'text' },
    ],
    exportFilename: 'inventory_movements',
    dataEndpoint: 'store/analytics/inventory/movements',
  },

  {
    id: 'inventory-movement-analysis',
    category: 'inventory',
    title: 'Analisis de Movimientos',
    description: 'Resumen y tendencias de movimientos por tipo',
    detailedDescription:
      'Analisis agregado de movimientos de inventario por tipo y periodo. Identifica patrones de rotacion y detecta anomalias.',
    icon: 'activity',
    route: '/admin/reports/inventory/inventory-movement-analysis',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    keyMapping: { count: 'transaction_count' },
    trackKey: 'movement_type',
    columns: [
      { key: 'movement_type', header: 'Tipo de Movimiento', type: 'text' },
      { key: 'total_quantity', header: 'Cantidad Total', type: 'number', footer: 'sum' },
      { key: 'transaction_count', header: 'Transacciones', type: 'number', footer: 'sum' },
      { key: 'percentage', header: 'Participacion', type: 'percentage' },
    ],
    exportFilename: 'inventory_movement_analysis',
    dataEndpoint: 'store/analytics/inventory/movement-summary',
  },

  // ─── PRODUCTOS (3) ────────────────────────────────────────────────────────────

  {
    id: 'product-performance',
    category: 'products',
    title: 'Rendimiento de Productos',
    description: 'Margen, rotacion y rentabilidad por producto',
    detailedDescription:
      'Evaluacion integral del rendimiento de cada producto: ventas, margen de ganancia, rotacion de inventario e indice de rentabilidad.',
    icon: 'gauge',
    route: '/admin/reports/products/product-performance',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'product_id',
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'units_sold', header: 'Unidades Vendidas', type: 'number', footer: 'sum' },
      { key: 'revenue', header: 'Ingreso', type: 'currency', footer: 'sum' },
      { key: 'order_count', header: 'Ordenes', type: 'number', footer: 'sum' },
      { key: 'avg_units_per_order', header: 'Unid/Orden', type: 'number', footer: 'average' },
      { key: 'return_rate', header: 'Tasa Devolucion', type: 'percentage' },
    ],
    exportFilename: 'product_performance',
    dataEndpoint: 'store/analytics/products/performance',
  },

  {
    id: 'product-top-sellers',
    category: 'products',
    title: 'Productos Mas Vendidos',
    description: 'Top sellers por cantidad vendida y por ingreso generado',
    detailedDescription:
      'Los productos mas exitosos de tu catalogo. Ranking dual: por unidades vendidas y por ingresos generados, para tomar decisiones de reabastecimiento.',
    icon: 'trophy',
    route: '/admin/reports/products/product-top-sellers',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'product_id',
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'units_sold', header: 'Unidades Vendidas', type: 'number', footer: 'sum' },
      { key: 'revenue', header: 'Ingreso Total', type: 'currency', footer: 'sum' },
      { key: 'average_price', header: 'Precio Promedio', type: 'currency', footer: 'average' },
      { key: 'profit_margin', header: 'Margen', type: 'percentage', footer: 'average' },
    ],
    exportFilename: 'product_top_sellers',
    dataEndpoint: 'store/analytics/products/top-sellers',
  },

  {
    id: 'product-profitability',
    category: 'products',
    title: 'Rentabilidad por Producto',
    description: 'Costo vs precio vs margen detallado de cada producto',
    detailedDescription:
      'Analisis de rentabilidad linea por linea. Compara precio de costo, precio de venta y margen real para optimizar tu catalogo de precios.',
    icon: 'percent',
    route: '/admin/reports/products/product-profitability',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'product_id',
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'revenue', header: 'Ingresos', type: 'currency', footer: 'sum' },
      { key: 'total_cost', header: 'Costo Total', type: 'currency', footer: 'sum' },
      { key: 'profit', header: 'Ganancia', type: 'currency', footer: 'sum' },
      { key: 'margin', header: 'Margen (%)', type: 'percentage', footer: 'average' },
      { key: 'units_sold', header: 'Unidades', type: 'number', footer: 'sum' },
    ],
    exportFilename: 'product_profitability',
    dataEndpoint: 'store/analytics/products/profitability',
  },

  // ─── CLIENTES (4) ─────────────────────────────────────────────────────────────

  {
    id: 'customer-summary',
    category: 'customers',
    title: 'Resumen de Clientes',
    description: 'Nuevos, activos, recurrentes y promedio de compra',
    detailedDescription:
      'Panorama general de tu base de clientes: cuantos son nuevos, cuantos repiten compra, y metricas clave como valor de vida del cliente y frecuencia de compra.',
    icon: 'users',
    route: '/admin/reports/customers/customer-summary',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'summary' as ReportType,
    summaryLayout: {
      fields: [
        { key: 'total_customers', label: 'Total Clientes', type: 'number' },
        { key: 'active_customers', label: 'Clientes Activos', type: 'number' },
        { key: 'new_customers', label: 'Clientes Nuevos', type: 'number' },
        { key: 'inactive_customers', label: 'Clientes Inactivos', type: 'number' },
        { key: 'average_spend', label: 'Gasto Promedio', type: 'currency' },
        { key: 'new_customers_growth', label: 'Crecimiento Nuevos', type: 'percentage' },
      ],
    },
    columns: [
      { key: 'metric', header: 'Metrica', type: 'text' },
      { key: 'value', header: 'Valor', type: 'number' },
      { key: 'change', header: 'Cambio', type: 'percentage' },
    ],
    exportFilename: 'customer_summary',
    dataEndpoint: 'store/analytics/customers/summary',
  },

  {
    id: 'customer-top',
    category: 'customers',
    title: 'Top Clientes',
    description: 'Clientes con mayor compra acumulada',
    detailedDescription:
      'Identifica a tus clientes mas valiosos por volumen de compra. Incluye historial de compras, frecuencia y ultimo pedido para estrategias de fidelizacion.',
    icon: 'crown',
    route: '/admin/reports/customers/customer-top',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'customer_id',
    columns: [
      { key: 'customer_name', header: 'Cliente', type: 'text' },
      { key: 'total_spent', header: 'Total Gastado', type: 'currency', footer: 'sum' },
      { key: 'total_orders', header: 'Ordenes', type: 'number', footer: 'sum' },
      { key: 'last_order_date', header: 'Ultima Orden', type: 'date' },
    ],
    exportFilename: 'customer_top',
    dataEndpoint: 'store/analytics/customers/top',
  },

  {
    id: 'customer-receivables',
    category: 'customers',
    title: 'Cuentas por Cobrar',
    description: 'Estado de deuda de clientes con saldos pendientes',
    detailedDescription:
      'Control de cartera de clientes con saldos pendientes. Muestra monto original, pagado, saldo y dias de mora para gestion efectiva de cobros.',
    icon: 'receipt',
    route: '/admin/reports/customers/customer-receivables',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'summary' as ReportType,
    summaryLayout: {
      fields: [
        { key: 'pending_amount', label: 'Monto Pendiente', type: 'currency' },
        { key: 'pending_count', label: 'Facturas Pendientes', type: 'number' },
        { key: 'overdue_amount', label: 'Monto Vencido', type: 'currency' },
        { key: 'overdue_count', label: 'Facturas Vencidas', type: 'number' },
        { key: 'due_soon_amount', label: 'Por Vencer', type: 'currency' },
        { key: 'collected_this_month', label: 'Cobrado Este Mes', type: 'currency' },
      ],
    },
    columns: [
      { key: 'customer_name', header: 'Cliente', type: 'text' },
      { key: 'balance', header: 'Saldo', type: 'currency', footer: 'sum' },
    ],
    exportFilename: 'customer_receivables',
    dataEndpoint: 'store/accounts-receivable/dashboard',
  },

  {
    id: 'customer-aging',
    category: 'customers',
    title: 'Cartera por Vencimiento',
    description: 'Aging report de cuentas por cobrar',
    detailedDescription:
      'Clasificacion de cartera por antiguedad: corriente, 1-30 dias, 31-60 dias, 61-90 dias y mas de 90 dias. Esencial para gestion de riesgo crediticio.',
    icon: 'clock',
    route: '/admin/reports/customers/customer-aging',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'nested' as ReportType,
    trackKey: 'customer_id',
    columns: [
      { key: 'customer_name', header: 'Cliente', type: 'text' },
      { key: 'current', header: 'Corriente', type: 'currency', footer: 'sum' },
      { key: 'days_1_30', header: '1-30 Dias', type: 'currency', footer: 'sum' },
      { key: 'days_31_60', header: '31-60 Dias', type: 'currency', footer: 'sum' },
      { key: 'days_61_90', header: '61-90 Dias', type: 'currency', footer: 'sum' },
      { key: 'over_90', header: '+90 Dias', type: 'currency', footer: 'sum' },
      { key: 'total', header: 'Total', type: 'currency', footer: 'sum' },
    ],
    exportFilename: 'customer_aging',
    dataEndpoint: 'store/accounts-receivable/aging',
  },

  // ─── CONTABILIDAD (5) ─────────────────────────────────────────────────────────

  {
    id: 'trial-balance',
    category: 'accounting',
    title: 'Balance de Prueba',
    description: 'Sumas y saldos por cuenta contable',
    detailedDescription:
      'Reporte contable fundamental que muestra los debitos y creditos totales de cada cuenta. Verifica que la contabilidad este balanceada.',
    icon: 'scale',
    route: '/admin/reports/accounting/trial-balance',
    requiresDateRange: true,
    requiresFiscalPeriod: true,
    type: 'summary' as ReportType,
    summaryLayout: {
      fields: [
        { key: 'total_debit', label: 'Total Debitos', type: 'currency' },
        { key: 'total_credit', label: 'Total Creditos', type: 'currency' },
      ],
    },
    columns: [
      { key: 'account_code', header: 'Codigo', type: 'text' },
      { key: 'account_name', header: 'Cuenta', type: 'text' },
      { key: 'debit', header: 'Debito', type: 'currency', footer: 'sum' },
      { key: 'credit', header: 'Credito', type: 'currency', footer: 'sum' },
      { key: 'balance', header: 'Saldo', type: 'currency', footer: 'sum' },
    ],
    exportFilename: 'trial_balance',
    dataEndpoint: 'store/accounting/reports/trial-balance',
    fullViewRoute: '/admin/accounting/reports/trial-balance',
  },

  {
    id: 'balance-sheet',
    category: 'accounting',
    title: 'Balance General',
    description: 'Activos, pasivos y patrimonio de la empresa',
    detailedDescription:
      'Estado de situacion financiera: activos, pasivos y patrimonio neto. Fotografia de la salud financiera de tu negocio en un momento dado.',
    icon: 'landmark',
    route: '/admin/reports/accounting/balance-sheet',
    requiresDateRange: true,
    requiresFiscalPeriod: true,
    type: 'nested' as ReportType,
    trackKey: 'account_code',
    columns: [
      { key: 'account_code', header: 'Codigo', type: 'text' },
      { key: 'account_name', header: 'Cuenta', type: 'text' },
      { key: 'amount', header: 'Monto', type: 'currency', footer: 'sum' },
    ],
    exportFilename: 'balance_sheet',
    dataEndpoint: 'store/accounting/reports/balance-sheet',
    fullViewRoute: '/admin/accounting/reports/balance-sheet',
  },

  {
    id: 'income-statement',
    category: 'accounting',
    title: 'Estado de Resultados',
    description: 'Ingresos menos gastos del periodo',
    detailedDescription:
      'Tu negocio genera ganancias? Este reporte muestra ingresos, costos y gastos para determinar la utilidad neta del periodo fiscal.',
    icon: 'file-bar-chart',
    route: '/admin/reports/accounting/income-statement',
    requiresDateRange: true,
    requiresFiscalPeriod: true,
    type: 'nested' as ReportType,
    trackKey: 'account_code',
    columns: [
      { key: 'account_code', header: 'Codigo', type: 'text' },
      { key: 'account_name', header: 'Cuenta', type: 'text' },
      { key: 'amount', header: 'Monto', type: 'currency', footer: 'sum' },
    ],
    exportFilename: 'income_statement',
    dataEndpoint: 'store/accounting/reports/income-statement',
    fullViewRoute: '/admin/accounting/reports/income-statement',
  },

  {
    id: 'general-ledger',
    category: 'accounting',
    title: 'Libro Mayor',
    description: 'Movimientos detallados por cuenta contable',
    detailedDescription:
      'Detalle completo de todos los movimientos contables por cuenta. Filtra por cuenta especifica para ver cada debito y credito registrado.',
    icon: 'book-open',
    route: '/admin/reports/accounting/general-ledger',
    requiresDateRange: true,
    requiresFiscalPeriod: true,
    type: 'list' as ReportType,
    trackKey: 'entry_number',
    columns: [
      { key: 'date', header: 'Fecha', type: 'date' },
      { key: 'entry_number', header: 'No. Asiento', type: 'text' },
      { key: 'description', header: 'Descripcion', type: 'text' },
      { key: 'debit', header: 'Debito', type: 'currency', footer: 'sum' },
      { key: 'credit', header: 'Credito', type: 'currency', footer: 'sum' },
      { key: 'balance', header: 'Saldo', type: 'currency' },
    ],
    exportFilename: 'general_ledger',
    dataEndpoint: 'store/accounting/reports/general-ledger',
    fullViewRoute: '/admin/accounting/reports/general-ledger',
  },

  {
    id: 'tax-summary',
    category: 'accounting',
    title: 'Resumen de Impuestos',
    description: 'IVA, retenciones e ICA del periodo',
    detailedDescription:
      'Consolidado de impuestos del periodo: IVA generado, IVA descontable, retenciones en la fuente, retencion de ICA y otros impuestos. Util para declaraciones tributarias.',
    icon: 'file-stack',
    route: '/admin/reports/accounting/tax-summary',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'summary' as ReportType,
    summaryLayout: {
      fields: [
        { key: 'total_tax_collected', label: 'Impuestos Recaudados', type: 'currency' },
        { key: 'total_tax_refunded', label: 'Impuestos Reembolsados', type: 'currency' },
        { key: 'net_tax', label: 'Impuesto Neto', type: 'currency' },
        { key: 'total_taxable_revenue', label: 'Base Gravable', type: 'currency' },
        { key: 'effective_tax_rate', label: 'Tasa Efectiva', type: 'percentage' },
      ],
    },
    columns: [
      { key: 'tax_type', header: 'Tipo de Impuesto', type: 'text' },
      { key: 'base_amount', header: 'Base', type: 'currency', footer: 'sum' },
      { key: 'tax_amount', header: 'Impuesto', type: 'currency', footer: 'sum' },
      { key: 'percentage', header: 'Porcentaje', type: 'percentage' },
    ],
    exportFilename: 'tax_summary',
    dataEndpoint: 'store/analytics/financial/tax-summary',
  },

  // ─── NOMINA (3) ───────────────────────────────────────────────────────────────

  {
    id: 'payroll-summary',
    category: 'payroll',
    title: 'Resumen de Nomina',
    description: 'Totales por periodo: devengados, deducciones y neto a pagar',
    detailedDescription:
      'Resumen consolidado de nomina con totales de devengados (salarios, auxilios, horas extra), deducciones (salud, pension, otros) y neto a pagar.',
    icon: 'banknote',
    route: '/admin/reports/payroll/payroll-summary',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'period',
    columns: [
      { key: 'period', header: 'Periodo', type: 'text' },
      { key: 'total_earnings', header: 'Total Devengado', type: 'currency', footer: 'sum' },
      { key: 'total_deductions', header: 'Total Deducciones', type: 'currency', footer: 'sum' },
      { key: 'employer_costs', header: 'Costos Empleador', type: 'currency', footer: 'sum' },
      { key: 'net_pay', header: 'Neto a Pagar', type: 'currency', footer: 'sum' },
      { key: 'employee_count', header: 'Empleados', type: 'number', footer: 'sum' },
    ],
    exportFilename: 'payroll_summary',
    dataEndpoint: 'store/reports/payroll/summary',
  },

  {
    id: 'payroll-by-employee',
    category: 'payroll',
    title: 'Nomina por Empleado',
    description: 'Detalle de cada empleado en el periodo de pago',
    detailedDescription:
      'Desglose individual por empleado: salario base, auxilios, horas extra, deducciones de ley, deducciones voluntarias y neto a pagar.',
    icon: 'user-cog',
    route: '/admin/reports/payroll/payroll-by-employee',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'employee_id',
    columns: [
      { key: 'employee_name', header: 'Empleado', type: 'text' },
      { key: 'base_salary', header: 'Salario Base', type: 'currency' },
      { key: 'earnings', header: 'Devengado', type: 'currency', footer: 'sum' },
      { key: 'deductions', header: 'Deducciones', type: 'currency', footer: 'sum' },
      { key: 'net_pay', header: 'Neto a Pagar', type: 'currency', footer: 'sum' },
    ],
    exportFilename: 'payroll_by_employee',
    dataEndpoint: 'store/reports/payroll/by-employee',
  },

  {
    id: 'payroll-provisions',
    category: 'payroll',
    title: 'Provisiones Laborales',
    description: 'Cesantias, primas, vacaciones e intereses acumulados',
    detailedDescription:
      'Estado actual de las provisiones de prestaciones sociales: cesantias, intereses de cesantias, prima de servicios y vacaciones acumuladas por empleado.',
    icon: 'piggy-bank',
    route: '/admin/reports/payroll/payroll-provisions',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'employee_id',
    columns: [
      { key: 'employee_name', header: 'Empleado', type: 'text' },
      { key: 'severance', header: 'Cesantias', type: 'currency', footer: 'sum' },
      { key: 'severance_interest', header: 'Int. Cesantias', type: 'currency', footer: 'sum' },
      { key: 'bonus', header: 'Prima', type: 'currency', footer: 'sum' },
      { key: 'vacation', header: 'Vacaciones', type: 'currency', footer: 'sum' },
      { key: 'total_provisions', header: 'Total Provisiones', type: 'currency', footer: 'sum' },
    ],
    exportFilename: 'payroll_provisions',
    dataEndpoint: 'store/reports/payroll/provisions',
  },

  // ─── FINANCIERO (4) ───────────────────────────────────────────────────────────

  {
    id: 'expense-summary',
    category: 'financial',
    title: 'Resumen de Gastos',
    description: 'Total y desglose por categoria de gasto',
    detailedDescription:
      'En que se va tu dinero? Desglose de gastos por categoria con montos, porcentaje de participacion y comparativa con periodo anterior.',
    icon: 'receipt',
    route: '/admin/reports/financial/expense-summary',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'summary' as ReportType,
    summaryLayout: {
      fields: [
        { key: 'total_amount', label: 'Total Gastos', type: 'currency' },
        { key: 'total_count', label: 'Total Transacciones', type: 'number' },
      ],
    },
    columns: [
      { key: 'category_name', header: 'Categoria', type: 'text' },
      { key: 'total_amount', header: 'Monto Total', type: 'currency', footer: 'sum' },
      { key: 'count', header: 'Transacciones', type: 'number', footer: 'sum' },
    ],
    exportFilename: 'expense_summary',
    dataEndpoint: 'store/expenses/summary',
  },

  {
    id: 'profit-loss',
    category: 'financial',
    title: 'Perdidas y Ganancias',
    description: 'Ingreso neto del negocio en el periodo',
    detailedDescription:
      'El reporte mas importante para duenos de negocio: cuanto ganaste realmente? Ingresos por ventas menos costos de mercancia, gastos operativos y otros gastos.',
    icon: 'trending-up',
    route: '/admin/reports/financial/profit-loss',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'nested' as ReportType,
    trackKey: 'account_code',
    columns: [
      { key: 'concept', header: 'Concepto', type: 'text' },
      { key: 'amount', header: 'Monto', type: 'currency', footer: 'sum' },
      { key: 'percentage', header: 'Porcentaje', type: 'percentage' },
    ],
    exportFilename: 'profit_loss',
    dataEndpoint: 'store/analytics/financial/profit-loss',
  },

  {
    id: 'cash-register-report',
    category: 'financial',
    title: 'Reporte de Caja',
    description: 'Resumen de sesiones de caja y movimientos',
    detailedDescription:
      'Control de caja con apertura, ventas por metodo de pago, gastos, movimientos de efectivo y cuadre de cierre. Detecta diferencias de caja.',
    icon: 'monitor-check',
    route: '/admin/reports/financial/cash-register-report',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'list' as ReportType,
    trackKey: 'session_id',
    columns: [
      { key: 'opened_at', header: 'Fecha Apertura', type: 'date' },
      { key: 'status', header: 'Estado', type: 'text' },
      { key: 'opening_amount', header: 'Apertura', type: 'currency' },
      { key: 'sales_total', header: 'Total Ventas', type: 'currency', footer: 'sum' },
      { key: 'total_movements', header: 'Movimientos', type: 'number', footer: 'sum' },
      { key: 'actual_closing_amount', header: 'Cierre', type: 'currency' },
      { key: 'difference', header: 'Diferencia', type: 'currency', footer: 'sum' },
    ],
    exportFilename: 'cash_register_report',
    dataEndpoint: 'store/analytics/financial/cash-sessions',
  },

  {
    id: 'accounts-payable-aging',
    category: 'financial',
    title: 'Vencimiento Ctas por Pagar',
    description: 'Aging de deuda a proveedores',
    detailedDescription:
      'Clasificacion de cuentas por pagar por antiguedad. Gestiona el flujo de caja planificando que proveedores pagar segun vencimiento.',
    icon: 'calendar-clock',
    route: '/admin/reports/financial/accounts-payable-aging',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    type: 'summary' as ReportType,
    summaryLayout: {
      fields: [
        { key: 'current', label: 'Corriente', type: 'currency' },
        { key: 'days_1_30', label: '1-30 Dias', type: 'currency' },
        { key: 'days_31_60', label: '31-60 Dias', type: 'currency' },
        { key: 'days_61_90', label: '61-90 Dias', type: 'currency' },
        { key: 'days_91_120', label: '91-120 Dias', type: 'currency' },
        { key: 'days_120_plus', label: '+120 Dias', type: 'currency' },
        { key: 'total', label: 'Total', type: 'currency' },
        { key: 'record_count', label: 'Registros', type: 'number' },
      ],
    },
    columns: [
      { key: 'supplier_name', header: 'Proveedor', type: 'text' },
      { key: 'total', header: 'Total', type: 'currency', footer: 'sum' },
    ],
    exportFilename: 'accounts_payable_aging',
    dataEndpoint: 'store/accounts-payable/aging',
  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

export function getReportById(id: string): ReportDefinition | undefined {
  return REPORT_DEFINITIONS.find((report) => report.id === id);
}

export function getReportsByCategory(categoryId: ReportCategoryId): ReportDefinition[] {
  return REPORT_DEFINITIONS.filter((report) => report.category === categoryId);
}

export function getCategoryById(id: ReportCategoryId): ReportCategory | undefined {
  return REPORT_CATEGORIES.find((category) => category.id === id);
}

export function getDefaultReportForCategory(categoryId: ReportCategoryId): ReportDefinition | undefined {
  return getReportsByCategory(categoryId)[0];
}
