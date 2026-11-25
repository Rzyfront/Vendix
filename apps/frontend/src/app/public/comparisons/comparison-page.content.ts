/**
 * SEO-OPS-30: datos de la comparativa. Cada fila sale de la página oficial de precios del proveedor
 * (revalidación del 19-nov-2026). Regla: si la página no publica un dato, se escribe «no publicado».
 */
export interface ComparisonRow {
  provider: string;
  plan: string;
  price: string;
  invoices: string;
  locations: string;
  restaurant: string;
  trial: string;
  sourceUrl: string;
  isVendix?: boolean;
}

export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    provider: 'Vendix',
    plan: 'Empresarial Pro',
    price: '$89.900/mes (mensual); $969.000/año',
    invoices: 'Ilimitadas*',
    locations: 'Varias ubicaciones (bodega y local) con traslados',
    restaurant: 'Sí: mesas, pedidos y pantalla de cocina',
    trial: '14 días',
    sourceUrl: 'https://vendix.online/pricing',
    isVendix: true,
  },
  {
    provider: 'Alegra POS',
    plan: 'Emprendedor',
    price: '$25.900/mes (mensual) o $233.100/año. Hasta $10.000.000/mes de ingresos. Incluye certificado digital',
    invoices: 'Ilimitadas',
    locations: '1',
    restaurant: 'Parcial: «pedidos, facturas y mesas»',
    trial: '15 días',
    sourceUrl: 'https://www.alegra.com/colombia/pos/precios/',
  },
  {
    provider: 'Siigo POS',
    plan: 'Sistema POS Esencial',
    price: '$345.000/año (solo anual; descuento para cliente nuevo)',
    invoices: '240 al año desde POS',
    locations: 'no publicado',
    restaurant: 'Plan aparte (GastroBar)',
    trial: 'no publicado',
    sourceUrl: 'https://www.siigo.com/precios-siigo/',
  },
  {
    provider: 'Loggro',
    plan: 'POS Tienda',
    price: '$54.990/mes; $659.880/año (incluye IVA del 0 %, según su página)',
    invoices: '350 al mes (ilimitadas con costo adicional)',
    locations: 'no publicado',
    restaurant: 'Plan aparte (Restobar)',
    trial: 'no publicado para POS',
    sourceUrl: 'https://loggro.com/sistema-pos/',
  },
  {
    provider: 'Treinta',
    plan: 'Pro (App + Web)',
    price: '$79.900/mes (mensual); $719.100/año',
    invoices: 'Ilimitadas',
    locations: 'no publicado',
    restaurant: 'Parcial: recetas',
    trial: 'no publicado',
    sourceUrl: 'https://treinta.co/planes-y-precios/',
  },
  {
    provider: 'Bold POS',
    plan: 'Esencial',
    price: '$963.000/año (solo anual)',
    invoices: '200 al mes (su ficha también dice «ilimitadas»)',
    locations: '1 sucursal',
    restaurant: 'no publicado',
    trial: 'no publicado',
    sourceUrl: 'https://bold.co/sistema-pos',
  },
  {
    provider: 'Vendty',
    plan: 'Emprendedor',
    price: '$155.000/mes (mensual)',
    invoices: 'Ilimitadas',
    locations: '1 punto de venta',
    restaurant: 'Comandas y recetas en Profesional y Empresarial; la ficha de Emprendedor menciona la app de comanda',
    trial: '7 días',
    sourceUrl: 'https://vendty.com/precios',
  },
];

export const COMPARISON_METHOD: readonly string[] = [
  'Solo comparamos planes que incluyen factura electrónica DIAN, para no poner lado a lado planes que no hacen lo mismo. En cada proveedor tomamos el primer plan que la incluye.',
  'Mostramos el precio como lo publica cada proveedor, con su ciclo de pago (mensual o anual).',
  'Si la página de un proveedor no publica un dato, escribimos «no publicado». Eso no quiere decir que no lo tenga.',
  'No sumamos ni restamos IVA: solo Loggro indica el IVA en su página.',
];

export const COMPARISON_CAVEATS: readonly string[] = [
  'Los topes cambian la comparación: Alegra limita por ingresos mensuales; Siigo, Loggro y Bold, por número de facturas.',
  'Usuarios, cajas y sucursales varían por plan. Revísalos en el enlace de cada proveedor.',
  'El precio de renovación de Siigo no aparece publicado: el descuento aplica solo a clientes nuevos.',
  'Las promociones temporales (por ejemplo, descuentos de temporada) no se incluyen en la tabla.',
];
