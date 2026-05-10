export interface AppModule {
  key: string;
  label: string;
  description?: string;
  isParent?: boolean;
  children?: AppModule[];
}

// Constant: Configuration of modules per app type
export const APP_MODULES: { [key: string]: AppModule[]; ORG_ADMIN: AppModule[]; STORE_ADMIN: AppModule[] } = {
  ORG_ADMIN: [
    {
      key: 'dashboard',
      label: 'Panel Principal',
      description: 'Vista general de la organizaci\u00f3n',
    },
    {
      key: 'stores',
      label: 'Tiendas',
      description: 'Gestionar tiendas de la organizaci\u00f3n',
    },
    {
      key: 'users',
      label: 'Usuarios',
      description: 'Gestionar usuarios y permisos',
    },
    {
      key: 'domains',
      label: 'Dominios',
      description: 'Gestionar dominios de la organizaci\u00f3n',
    },
    {
      key: 'audit',
      label: 'Auditor\u00eda',
      description: 'Logs de auditor\u00eda del sistema',
    },
    {
      key: 'settings',
      label: 'Configuraci\u00f3n',
      description: 'Ajustes de la organizaci\u00f3n',
      isParent: true,
      children: [
        {
          key: 'settings_operations',
          label: 'Operaci\u00f3n',
          description: 'Alcance operativo y modelo multi-tienda',
        },
        {
          key: 'settings_fiscal_scope',
          label: 'Modo fiscal',
          description: 'Alcance fiscal y modelo DIAN por tienda u organizaci\u00f3n',
        },
        {
          key: 'settings_application',
          label: 'General',
          description: 'Configuraci\u00f3n general de la aplicaci\u00f3n',
        },
        {
          key: 'settings_payment_methods',
          label: 'M\u00e9todos de Pago',
          description: 'Configuraci\u00f3n de m\u00e9todos de pago',
        },
      ],
    },
    {
      key: 'accounting',
      label: 'Contabilidad',
      description: 'Plan de cuentas y asientos contables',
    },
    {
      key: 'payroll',
      label: 'N\u00f3mina',
      description: 'Gesti\u00f3n de n\u00f3mina consolidada',
    },
  ],
  STORE_ADMIN: [
    // M\u00f3dulos principales (standalone - sin hijos)
    {
      key: 'dashboard',
      label: 'Panel Principal',
      description: 'Vista general de la tienda',
    },
    {
      key: 'pos',
      label: 'Punto de Venta',
      description: 'Ventas en tienda f\u00edsica',
    },
    {
      key: 'products',
      label: 'Productos',
      description: 'Gestionar cat\u00e1logo de productos',
    },
    {
      key: 'ecommerce',
      label: 'E-commerce',
      description: 'Ventas online de la tienda',
    },

    // \u00d3rdenes (padre con hijos)
    {
      key: 'orders',
      label: '\u00d3rdenes',
      description: 'Secci\u00f3n de \u00f3rdenes',
      isParent: true,
      children: [
        {
          key: 'orders_sales',
          label: '\u00d3rdenes de Venta',
          description: '\u00d3rdenes de venta',
        },
        {
          key: 'orders_purchase_orders',
          label: '\u00d3rdenes de Compra',
          description: '\u00d3rdenes de compra a proveedores',
        },
        {
          key: 'orders_quotations',
          label: 'Cotizaciones',
          description: 'Cotizaciones y presupuestos para clientes',
        },
        {
          key: 'orders_layaway',
          label: 'Plan Separe',
          description: 'Planes de pago a cuotas con reserva de productos',
        },
        {
          key: 'orders_reservations',
          label: 'Reservas',
          description: 'Gesti\u00f3n de reservas y agendamiento de servicios',
        },
        {
          key: 'orders_dispatch_notes',
          label: 'Remisiones',
          description: 'Notas de despacho / remisiones',
        },
      ],
    },

    // Inventario (padre con hijos)
    {
      key: 'inventory',
      label: 'Inventario',
      description: 'Secci\u00f3n de inventario',
      isParent: true,
      children: [
        {
          key: 'inventory_pop',
          label: 'Punto de Compra',
          description: 'Punto de compra a proveedores',
        },
        {
          key: 'inventory_adjustments',
          label: 'Ajustes de Stock',
          description: 'Ajustes manuales de inventario',
        },
        {
          key: 'inventory_locations',
          label: 'Ubicaciones',
          description: 'Ubicaciones de almacenamiento',
        },
        {
          key: 'inventory_suppliers',
          label: 'Proveedores',
          description: 'Directorio de proveedores',
        },
        {
          key: 'inventory_movements',
          label: 'Movimientos',
          description: 'Historial de movimientos de inventario',
        },
        {
          key: 'inventory_transfers',
          label: 'Transferencias',
          description: 'Transferencias de inventario entre ubicaciones',
        },
      ],
    },

    // Clientes (padre con hijos)
    {
      key: 'customers',
      label: 'Clientes',
      description: 'Secci\u00f3n de clientes',
      isParent: true,
      children: [
        {
          key: 'customers_all',
          label: 'Todos los Clientes',
          description: 'Directorio completo de clientes',
        },
        {
          key: 'customers_reviews',
          label: 'Rese\u00f1as',
          description: 'Rese\u00f1as de clientes',
        },
        {
          key: 'customers_data_collection',
          label: 'Recolección de Datos',
          description: 'Campos personalizados y formularios de preconsulta',
        },
      ],
    },

    // Marketing (padre con hijos)
    {
      key: 'marketing',
      label: 'Marketing',
      description: 'Secci\u00f3n de marketing',
      isParent: true,
      children: [
        {
          key: 'marketing_promotions',
          label: 'Promociones',
          description: 'Promociones y descuentos',
        },
        {
          key: 'marketing_coupons',
          label: 'Cupones',
          description: 'Cupones de descuento',
        },
      ],
    },

    // Anal\u00edticas (padre con hijos)
    {
      key: 'analytics',
      label: 'Anal\u00edticas',
      description: 'Secci\u00f3n de anal\u00edticas',
      isParent: true,
      children: [
        {
          key: 'analytics_overview',
          label: 'Resumen',
          description: 'Resumen general de anal\u00edticas',
        },
        {
          key: 'analytics_sales',
          label: 'Ventas',
          description: 'M\u00e9tricas de ventas',
        },
        {
          key: 'analytics_traffic',
          label: 'Tr\u00e1fico',
          description: 'An\u00e1lisis de tr\u00e1fico web',
        },
        {
          key: 'analytics_performance',
          label: 'Rendimiento',
          description: 'KPIs de rendimiento',
        },
        {
          key: 'analytics_inventory',
          label: 'Anal\u00edticas de Inventario',
          description: 'An\u00e1lisis de inventario y rotaci\u00f3n',
        },
        {
          key: 'analytics_products',
          label: 'Anal\u00edticas de Productos',
          description: 'Desempe\u00f1o de productos y cat\u00e1logo',
        },
        {
          key: 'analytics_customers',
          label: 'Anal\u00edticas de Clientes',
          description: 'Resumen y segmentaci\u00f3n de clientes',
        },
        {
          key: 'analytics_financial',
          label: 'Financiero',
          description: 'P\u00e9rdidas y ganancias, m\u00e1rgenes financieros',
        },
      ],
    },

    // Gastos
    {
      key: 'expenses',
      label: 'Gastos',
      description: 'Secci\u00f3n de gastos',
    },

    // Facturaci\u00f3n (padre con hijos)
    {
      key: 'invoicing',
      label: 'Facturaci\u00f3n',
      description: 'Emisi\u00f3n y gesti\u00f3n de facturas electr\u00f3nicas',
      isParent: true,
      children: [
        {
          key: 'invoicing_invoices',
          label: 'Facturas',
          description: 'Listado y gesti\u00f3n de facturas electr\u00f3nicas',
        },
        {
          key: 'invoicing_resolutions',
          label: 'Resoluciones',
          description: 'Resoluciones de facturaci\u00f3n DIAN',
        },
        {
          key: 'invoicing_dian_config',
          label: 'Configuraci\u00f3n DIAN',
          description: 'Par\u00e1metros y credenciales para facturaci\u00f3n electr\u00f3nica DIAN',
        },
      ],
    },

    // Contabilidad (padre con hijos)
    {
      key: 'accounting',
      label: 'Contabilidad',
      description: 'Plan de cuentas y asientos contables',
      isParent: true,
      children: [
        {
          key: 'accounting_journal_entries',
          label: 'Asientos Contables',
          description: 'Registro de asientos contables',
        },
        {
          key: 'accounting_chart_of_accounts',
          label: 'Plan de Cuentas',
          description: 'Estructura de cuentas contables',
        },
        {
          key: 'accounting_fiscal_periods',
          label: 'Periodos Fiscales',
          description: 'Gesti\u00f3n de periodos fiscales',
        },
        {
          key: 'accounting_account_mappings',
          label: 'Mapeo de Cuentas',
          description: 'Configuraci\u00f3n de cuentas contables por flujo',
        },
        {
          key: 'accounting_reports',
          label: 'Reportes',
          description: 'Reportes contables y financieros',
        },
        {
          key: 'accounting_flows_dashboard',
          label: 'Flujos Contables',
          description: 'Dashboard de flujos contables autom\u00e1ticos',
        },
        {
          key: 'cartera_dashboard',
          label: 'Cartera',
          description: 'Dashboard de cartera con CxC y CxP',
        },
        {
          key: 'cartera_receivables',
          label: 'Cuentas por Cobrar',
          description: 'Gesti\u00f3n de cuentas por cobrar',
        },
        {
          key: 'cartera_payables',
          label: 'Cuentas por Pagar',
          description: 'Gesti\u00f3n de cuentas por pagar',
        },
        {
          key: 'cartera_aging',
          label: 'Cartera por Vencimiento',
          description: 'Reporte de antig\u00fcedad de cartera',
        },
        {
          key: 'accounting_withholding_tax',
          label: 'Retenciones',
          description: 'Gesti\u00f3n de retenciones en la fuente y autoretenciones',
        },
        {
          key: 'accounting_exogenous',
          label: 'Info Ex\u00f3gena',
          description: 'Reportes de informaci\u00f3n ex\u00f3gena DIAN',
        },
        {
          key: 'taxes_ica',
          label: 'ICA Municipal',
          description: 'Impuesto de industria y comercio municipal',
        },
      ],
    },

    // N\u00f3mina (padre con hijos)
    {
      key: 'payroll',
      label: 'N\u00f3mina',
      description: 'Gesti\u00f3n de empleados y liquidaci\u00f3n de n\u00f3mina',
      isParent: true,
      children: [
        {
          key: 'payroll_employees',
          label: 'Empleados',
          description: 'Directorio de empleados',
        },
        {
          key: 'payroll_runs',
          label: 'Per\u00edodos de N\u00f3mina',
          description: 'Per\u00edodos y corridas de n\u00f3mina',
        },
        {
          key: 'payroll_settlements',
          label: 'Liquidaciones',
          description: 'Liquidaci\u00f3n por terminaci\u00f3n de empleados',
        },
        {
          key: 'payroll_advances',
          label: 'Adelantos',
          description: 'Adelantos y pr\u00e9stamos a empleados',
        },
        {
          key: 'payroll_settings',
          label: 'Configuraci\u00f3n N\u00f3mina',
          description: 'Reglas y par\u00e1metros de n\u00f3mina',
        },
      ],
    },

    // Configuraci\u00f3n (padre con hijos)
    {
      key: 'settings',
      label: 'Configuraci\u00f3n',
      description: 'Secci\u00f3n de configuraci\u00f3n',
      isParent: true,
      children: [
        {
          key: 'settings_general',
          label: 'General',
          description: 'Configuraci\u00f3n general de la tienda',
        },
        {
          key: 'settings_payments',
          label: 'M\u00e9todos de Pago',
          description: 'M\u00e9todos de pago aceptados',
        },
        {
          key: 'settings_appearance',
          label: 'Apariencia',
          description: 'Personalizaci\u00f3n visual',
        },
        {
          key: 'settings_security',
          label: 'Seguridad',
          description: 'Configuraci\u00f3n de seguridad',
        },
        {
          key: 'settings_domains',
          label: 'Dominios',
          description: 'Dominios de la tienda online',
        },
        {
          key: 'settings_shipping',
          label: 'M\u00e9todos de Env\u00edo',
          description: 'Configuraci\u00f3n de m\u00e9todos de env\u00edo y zonas',
        },
        {
          key: 'settings_legal_documents',
          label: 'Documentos Legales',
          description: 'Gestionar t\u00e9rminos, privacidad y documentos legales',
        },
        {
          key: 'settings_users',
          label: 'Usuarios',
          description: 'Gestionar usuarios de la tienda',
        },
        {
          key: 'settings_roles',
          label: 'Roles',
          description: 'Gestionar roles y permisos de la tienda',
        },
        {
          key: 'settings_cash_registers',
          label: 'Caja Registradora',
          description: 'Gesti\u00f3n de cajas, sesiones y movimientos',
        },
      ],
    },
    // Ayuda (padre con hijos)
    {
      key: 'help',
      label: 'Ayuda',
      description: 'Secci\u00f3n de ayuda y soporte',
      isParent: true,
      children: [
        {
          key: 'help_support',
          label: 'Soporte',
          description: 'Acceso a la secci\u00f3n de soporte',
        },
        {
          key: 'help_center',
          label: 'Centro de Ayuda',
          description: 'Art\u00edculos y gu\u00edas del centro de ayuda',
        },
      ],
    },
  ],
};
