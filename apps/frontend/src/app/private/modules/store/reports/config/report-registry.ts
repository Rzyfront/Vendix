import { ReportCategory, ReportCategoryId, ReportDefinition } from '../interfaces/report.interface';

export const REPORT_CATEGORIES: ReportCategory[] = [
  { id: 'sales', label: 'Ventas', icon: 'shopping-cart', color: 'var(--color-primary)' },
  { id: 'inventory', label: 'Inventario', icon: 'warehouse', color: 'var(--color-warning)' },
  { id: 'products', label: 'Productos', icon: 'package', color: 'var(--color-accent)' },
  { id: 'customers', label: 'Clientes', icon: 'users', color: 'var(--color-info)' },
  { id: 'accounting', label: 'Contabilidad', icon: 'book-open', color: 'var(--color-secondary)' },
  { id: 'payroll', label: 'Nomina', icon: 'banknote', color: 'var(--color-success)' },
  { id: 'financial', label: 'Financiero', icon: 'wallet', color: 'var(--color-destructive)' },
];

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  // ─── VENTAS (7) ───────────────────────────────────────────────────────────────

  {
    id: 'sales-summary',
    category: 'sales',
    title: 'Resumen de Ventas',
    description: 'Totales de ventas, promedios y ticket promedio del periodo',
    detailedDescription:
      'Visualiza un resumen completo de las ventas del periodo seleccionado, incluyendo total facturado, cantidad de ordenes, ticket promedio, descuentos aplicados y comparativa con periodo anterior.',
    icon: 'bar-chart-3',
    requiresDateRange: true,
    requiresFiscalPeriod: false,
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'quantity_sold', header: 'Cantidad Vendida', type: 'number', footer: 'sum' },
      { key: 'total_revenue', header: 'Ingreso Total', type: 'currency', footer: 'sum' },
      { key: 'avg_price', header: 'Precio Promedio', type: 'currency', footer: 'average' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'category_name', header: 'Categoria', type: 'text' },
      { key: 'total_sales', header: 'Total Ventas', type: 'currency', footer: 'sum' },
      { key: 'order_count', header: 'Cantidad Ordenes', type: 'number', footer: 'sum' },
      { key: 'percentage', header: 'Participacion', type: 'percentage' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'customer_name', header: 'Cliente', type: 'text' },
      { key: 'total_purchases', header: 'Total Compras', type: 'currency', footer: 'sum' },
      { key: 'order_count', header: 'Cantidad Ordenes', type: 'number', footer: 'sum' },
      { key: 'avg_ticket', header: 'Ticket Promedio', type: 'currency', footer: 'average' },
      { key: 'last_purchase', header: 'Ultima Compra', type: 'date' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'payment_method', header: 'Metodo de Pago', type: 'text' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'channel', header: 'Canal', type: 'text' },
      { key: 'total_sales', header: 'Total Ventas', type: 'currency', footer: 'sum' },
      { key: 'order_count', header: 'Cantidad Ordenes', type: 'number', footer: 'sum' },
      { key: 'avg_ticket', header: 'Ticket Promedio', type: 'currency', footer: 'average' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
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
    requiresDateRange: false,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'quantity_on_hand', header: 'Cantidad Disponible', type: 'number', footer: 'sum' },
      { key: 'cost_per_unit', header: 'Costo Unitario', type: 'currency' },
      { key: 'total_cost', header: 'Costo Total', type: 'currency', footer: 'sum' },
      { key: 'sale_price', header: 'Precio de Venta', type: 'currency' },
      { key: 'total_value', header: 'Valor Total', type: 'currency', footer: 'sum' },
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
    requiresDateRange: false,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'location', header: 'Ubicacion', type: 'text' },
      { key: 'quantity_on_hand', header: 'En Mano', type: 'number', footer: 'sum' },
      { key: 'quantity_reserved', header: 'Reservado', type: 'number', footer: 'sum' },
      { key: 'quantity_available', header: 'Disponible', type: 'number', footer: 'sum' },
      { key: 'reorder_point', header: 'Punto de Reorden', type: 'number' },
    ],
    exportFilename: 'inventory_stock_levels',
    dataEndpoint: 'store/analytics/inventory/overview',
  },

  {
    id: 'inventory-low-stock',
    category: 'inventory',
    title: 'Productos con Bajo Stock',
    description: 'Productos por debajo del punto de reorden',
    detailedDescription:
      'Alertas de productos que necesitan reabastecimiento. Muestra los productos cuyo stock disponible esta por debajo del punto de reorden configurado.',
    icon: 'alert-triangle',
    requiresDateRange: false,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'current_stock', header: 'Stock Actual', type: 'number' },
      { key: 'reorder_point', header: 'Punto de Reorden', type: 'number' },
      { key: 'deficit', header: 'Deficit', type: 'number' },
      { key: 'last_restock_date', header: 'Ultimo Reabastecimiento', type: 'date' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'date', header: 'Fecha', type: 'date' },
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'movement_type', header: 'Tipo', type: 'text' },
      { key: 'quantity', header: 'Cantidad', type: 'number', footer: 'sum' },
      { key: 'reference', header: 'Referencia', type: 'text' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'units_sold', header: 'Unidades Vendidas', type: 'number', footer: 'sum' },
      { key: 'revenue', header: 'Ingreso', type: 'currency', footer: 'sum' },
      { key: 'cost', header: 'Costo', type: 'currency', footer: 'sum' },
      { key: 'margin', header: 'Margen', type: 'percentage', footer: 'average' },
      { key: 'turnover_rate', header: 'Rotacion', type: 'number', footer: 'average' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'rank', header: '#', type: 'number', align: 'center' },
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'units_sold', header: 'Unidades Vendidas', type: 'number', footer: 'sum' },
      { key: 'total_revenue', header: 'Ingreso Total', type: 'currency', footer: 'sum' },
      { key: 'avg_price', header: 'Precio Promedio', type: 'currency', footer: 'average' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'cost_price', header: 'Precio de Costo', type: 'currency' },
      { key: 'sale_price', header: 'Precio de Venta', type: 'currency' },
      { key: 'margin_amount', header: 'Margen ($)', type: 'currency', footer: 'sum' },
      { key: 'margin_percentage', header: 'Margen (%)', type: 'percentage', footer: 'average' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'customer_name', header: 'Cliente', type: 'text' },
      { key: 'total_spent', header: 'Total Gastado', type: 'currency', footer: 'sum' },
      { key: 'order_count', header: 'Ordenes', type: 'number', footer: 'sum' },
      { key: 'avg_order', header: 'Promedio Orden', type: 'currency', footer: 'average' },
      { key: 'last_order', header: 'Ultima Orden', type: 'date' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'customer_name', header: 'Cliente', type: 'text' },
      { key: 'original_amount', header: 'Monto Original', type: 'currency', footer: 'sum' },
      { key: 'paid_amount', header: 'Pagado', type: 'currency', footer: 'sum' },
      { key: 'balance', header: 'Saldo', type: 'currency', footer: 'sum' },
      { key: 'days_overdue', header: 'Dias Mora', type: 'number' },
      { key: 'status', header: 'Estado', type: 'text' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
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
    requiresDateRange: false,
    requiresFiscalPeriod: true,
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
    requiresDateRange: false,
    requiresFiscalPeriod: true,
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
    requiresDateRange: false,
    requiresFiscalPeriod: true,
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
    requiresDateRange: false,
    requiresFiscalPeriod: true,
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'category', header: 'Categoria', type: 'text' },
      { key: 'total_amount', header: 'Monto Total', type: 'currency', footer: 'sum' },
      { key: 'transaction_count', header: 'Transacciones', type: 'number', footer: 'sum' },
      { key: 'percentage', header: 'Participacion', type: 'percentage' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'session_date', header: 'Fecha', type: 'date' },
      { key: 'cashier', header: 'Cajero', type: 'text' },
      { key: 'opening_amount', header: 'Apertura', type: 'currency' },
      { key: 'total_sales', header: 'Total Ventas', type: 'currency', footer: 'sum' },
      { key: 'total_expenses', header: 'Total Gastos', type: 'currency', footer: 'sum' },
      { key: 'closing_amount', header: 'Cierre', type: 'currency' },
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
    requiresDateRange: true,
    requiresFiscalPeriod: false,
    columns: [
      { key: 'supplier_name', header: 'Proveedor', type: 'text' },
      { key: 'current', header: 'Corriente', type: 'currency', footer: 'sum' },
      { key: 'days_1_30', header: '1-30 Dias', type: 'currency', footer: 'sum' },
      { key: 'days_31_60', header: '31-60 Dias', type: 'currency', footer: 'sum' },
      { key: 'days_61_90', header: '61-90 Dias', type: 'currency', footer: 'sum' },
      { key: 'over_90', header: '+90 Dias', type: 'currency', footer: 'sum' },
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
