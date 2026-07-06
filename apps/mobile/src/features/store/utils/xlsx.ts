import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform, Alert } from 'react-native';
import type { Product } from '@/features/store/types';

/* ============================================================
 * Bulk product upload — columnas y sample rows
 * ============================================================
 * Mirror exacto de `products-bulk.service.ts:generateExcelTemplate()`
 * (apps/backend/src/domains/store/products/products-bulk.service.ts:864-1075).
 * Cualquier divergencia causa errores de validación en el analyze.
 */

const PRODUCT_TEMPLATE_HEADERS = [
  'Nombre',
  'SKU',
  'Tipo',
  'Estado',
  'Controla Inventario',
  'Precio Venta',
  'Descripción',
  'Marca',
  'Categorías',
  'Impuestos IDs',
  'Tipo Precio',
  'Disponible Ecommerce',
  'Destacado',
  'Permite Cambiar Precio POS',
  'Usa Listas de Precio',
  'Peso',
  'En Oferta',
  'Precio Oferta',
] as const;

const SERVICE_TEMPLATE_HEADERS = [
  'Nombre',
  'SKU',
  'Tipo',
  'Estado',
  'Precio Venta',
  'Descripción',
  'Marca',
  'Categorías',
  'Impuestos IDs',
  'Disponible Ecommerce',
  'Destacado',
  'Permite Cambiar Precio POS',
  'En Oferta',
  'Precio Oferta',
  'Duración Servicio (min)',
  'Modalidad Servicio',
  'Tipo Precio Servicio',
  'Requiere Reserva',
  'Modo Reserva',
  'Buffer (min)',
  'Es Recurrente',
  'Instrucciones Servicio',
  'Es Consulta',
  'Enviar Preconsulta',
  'Plantilla Consulta ID',
  'Plantilla Preconsulta ID',
  'Tiempo Preparación (min)',
] as const;

const PRODUCT_SAMPLE_ROWS: Record<string, unknown>[] = [
  {
    Nombre: 'Zapatillas Running Pro',
    SKU: 'ZAP-RUN-PRO-42',
    Tipo: 'físico',
    Estado: 'activo',
    'Controla Inventario': 'sí',
    'Precio Venta': 85000,
    Descripción: 'Zapatillas ideales para correr largas distancias.',
    Marca: 'Nike',
    Categorías: 'Deportes, Calzado',
    'Impuestos IDs': '',
    'Tipo Precio': 'unidad',
    'Disponible Ecommerce': 'sí',
    Destacado: 'sí',
    'Permite Cambiar Precio POS': 'no',
    'Usa Listas de Precio': 'no',
    Peso: 0.8,
    'En Oferta': 'no',
    'Precio Oferta': 0,
  },
  {
    Nombre: 'Leche Entera 1L',
    SKU: 'LEC-ENT-1L-COL',
    Tipo: 'físico',
    Estado: 'activo',
    'Controla Inventario': 'sí',
    'Precio Venta': 5200,
    Descripción: 'Leche entera pasteurizada de origen colombiano.',
    Marca: 'Colanta',
    Categorías: 'Alimentos, Lácteos',
    'Impuestos IDs': '',
    'Tipo Precio': 'unidad',
    'Disponible Ecommerce': 'no',
    Destacado: 'no',
    'Permite Cambiar Precio POS': 'no',
    'Usa Listas de Precio': 'no',
    Peso: 1.05,
    'En Oferta': 'no',
    'Precio Oferta': 0,
  },
  {
    Nombre: 'Frutas Orgánicas Mix 1kg',
    SKU: 'FRU-ORG-MIX-1KG',
    Tipo: 'físico',
    Estado: 'activo',
    'Controla Inventario': 'no',
    'Precio Venta': 22000,
    Descripción: 'Mix de frutas orgánicas de temporada por kilo.',
    Marca: '',
    Categorías: 'Alimentos, Orgánicos',
    'Impuestos IDs': '',
    'Tipo Precio': 'peso',
    'Disponible Ecommerce': 'sí',
    Destacado: 'no',
    'Permite Cambiar Precio POS': 'sí',
    'Usa Listas de Precio': 'sí',
    Peso: 1,
    'En Oferta': 'sí',
    'Precio Oferta': 19000,
  },
];

const SERVICE_SAMPLE_ROWS: Record<string, unknown>[] = [
  {
    Nombre: 'Asesoría Tributaria',
    SKU: 'SVC-ASE-TRI-001',
    Tipo: 'servicio',
    Estado: 'activo',
    'Precio Venta': 150000,
    Descripción: 'Asesoría tributaria profesional por sesión.',
    Marca: '',
    Categorías: 'Servicios, Contabilidad',
    'Impuestos IDs': '',
    'Disponible Ecommerce': 'sí',
    Destacado: 'no',
    'Permite Cambiar Precio POS': 'no',
    'En Oferta': 'no',
    'Precio Oferta': 0,
    'Duración Servicio (min)': 60,
    'Modalidad Servicio': 'presencial',
    'Tipo Precio Servicio': 'por hora',
    'Requiere Reserva': 'sí',
    'Modo Reserva': 'proveedor',
    'Buffer (min)': 15,
    'Es Recurrente': 'no',
    'Instrucciones Servicio': 'Traer cédula y comprobante de pago.',
    'Es Consulta': 'no',
    'Enviar Preconsulta': 'no',
    'Plantilla Consulta ID': '',
    'Plantilla Preconsulta ID': '',
    'Tiempo Preparación (min)': 15,
  },
  {
    Nombre: 'Consultoría Estratégica Virtual',
    SKU: 'SVC-CON-EST-001',
    Tipo: 'servicio',
    Estado: 'activo',
    'Precio Venta': 250000,
    Descripción: 'Consultoría estratégica virtual por sesión de 90 minutos.',
    Marca: '',
    Categorías: 'Servicios, Consultoría',
    'Impuestos IDs': '',
    'Disponible Ecommerce': 'sí',
    Destacado: 'sí',
    'Permite Cambiar Precio POS': 'no',
    'En Oferta': 'no',
    'Precio Oferta': 0,
    'Duración Servicio (min)': 90,
    'Modalidad Servicio': 'virtual',
    'Tipo Precio Servicio': 'por sesión',
    'Requiere Reserva': 'sí',
    'Modo Reserva': 'libre',
    'Buffer (min)': 10,
    'Es Recurrente': 'no',
    'Instrucciones Servicio': 'Conexión por videollamada 5 minutos antes de la sesión.',
    'Es Consulta': 'no',
    'Enviar Preconsulta': 'no',
    'Plantilla Consulta ID': '',
    'Plantilla Preconsulta ID': '',
    'Tiempo Preparación (min)': 10,
  },
  {
    Nombre: 'Mantenimiento Preventivo Anual',
    SKU: 'SVC-MNT-PRE-001',
    Tipo: 'servicio',
    Estado: 'activo',
    'Precio Venta': 480000,
    Descripción: 'Plan de mantenimiento preventivo anual para equipos.',
    Marca: '',
    Categorías: 'Servicios, Mantenimiento',
    'Impuestos IDs': '',
    'Disponible Ecommerce': 'sí',
    Destacado: 'no',
    'Permite Cambiar Precio POS': 'sí',
    'En Oferta': 'no',
    'Precio Oferta': 0,
    'Duración Servicio (min)': 120,
    'Modalidad Servicio': 'híbrido',
    'Tipo Precio Servicio': 'suscripción',
    'Requiere Reserva': 'no',
    'Modo Reserva': '',
    'Buffer (min)': 0,
    'Es Recurrente': 'sí',
    'Instrucciones Servicio': 'Coordinar visita técnica con anticipación de 24 horas.',
    'Es Consulta': 'no',
    'Enviar Preconsulta': 'no',
    'Plantilla Consulta ID': '',
    'Plantilla Preconsulta ID': '',
    'Tiempo Preparación (min)': 30,
  },
];

/* ============================================================
 * Internal helpers (reused)
 * ============================================================ */

function rowsToSheet(rows: Record<string, unknown>[], headers: readonly string[]) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers as string[] });
  ws['!cols'] = headers.map(() => ({ wch: 20 }));
  return ws;
}

function workbookToBase64(wb: XLSX.WorkBook): string {
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

async function shareBase64(base64: string, filename: string) {
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (Platform.OS === 'web') {
    const link = document.createElement('a');
    link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
    link.download = filename;
    link.click();
    return;
  }

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: filename,
    });
  } else {
    Alert.alert('Descarga completa', `Archivo guardado en: ${fileUri}`);
  }
}

function buildTemplateXlsx(
  headers: readonly string[],
  sampleRows: Record<string, unknown>[],
  sheetName: string,
): string {
  const ws = rowsToSheet(sampleRows, headers);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return workbookToBase64(wb);
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Descarga la plantilla de productos (18 columnas) en formato Excel.
 * Sheet name: "Plantilla Productos". Coincide 1-a-1 con `generateExcelTemplate('products')`.
 */
export async function downloadProductsTemplate(): Promise<void> {
  const base64 = buildTemplateXlsx(
    PRODUCT_TEMPLATE_HEADERS,
    PRODUCT_SAMPLE_ROWS,
    'Plantilla Productos',
  );
  await shareBase64(base64, 'plantilla_productos.xlsx');
}

/**
 * Descarga la plantilla de servicios (27 columnas) en formato Excel.
 * Sheet name: "Plantilla Servicios". Coincide 1-a-1 con `generateExcelTemplate('services')`.
 */
export async function downloadServicesTemplate(): Promise<void> {
  const base64 = buildTemplateXlsx(
    SERVICE_TEMPLATE_HEADERS,
    SERVICE_SAMPLE_ROWS,
    'Plantilla Servicios',
  );
  await shareBase64(base64, 'plantilla_servicios.xlsx');
}

/**
 * Dispatcher unificado — recomendado para los botones del modal bulk.
 * Mantiene `downloadEmptyTemplate()` como alias deprecated para
 * `downloadProductsTemplate()` por compatibilidad con llamadas existentes.
 */
export async function downloadTemplate(type: 'products' | 'services' = 'products'): Promise<void> {
  if (type === 'services') return downloadServicesTemplate();
  return downloadProductsTemplate();
}

/**
 * @deprecated usar `downloadProductsTemplate()` o `downloadTemplate('products')`.
 * Mantenido como alias para no romper callers externos.
 */
export const downloadEmptyTemplate = downloadProductsTemplate;

/**
 * Construye un XLSX con los productos actuales del store (en el mismo
 * formato de la plantilla + columnas informativas) y abre el share sheet.
 * Usado por "Descargar plantilla con productos actuales" en la lista.
 */
export async function downloadCurrentProducts(products: Product[]): Promise<void> {
  const rows = products.map((p) => {
    // Cast pragmático: Product expone flags comerciales básicos
    // (is_featured, allow_pos_price_override, has_multiple_price_tiers)
    // vía intersección de tipos en runtime pero no en el type estático.
    const extended = p as Product & {
      is_featured?: boolean;
      allow_pos_price_override?: boolean;
      has_multiple_price_tiers?: boolean;
      weight?: number;
      sale_price?: number;
    };
    return {
      Nombre: p.name,
      SKU: p.sku ?? '',
      Tipo: p.product_type ?? 'physical',
      Estado: p.state ?? 'active',
      'Controla Inventario': p.track_inventory ? 'sí' : 'no',
      'Precio Venta': p.base_price,
      Descripción: p.description ?? '',
      Marca: p.brand?.name ?? '',
      Categorías: p.categories?.map((c) => c.name).join(', ') ?? '',
      'Impuestos IDs': '',
      'Tipo Precio': p.pricing_type ?? 'unidad',
      'Disponible Ecommerce': p.available_for_ecommerce ? 'sí' : 'no',
      Destacado: extended.is_featured ? 'sí' : 'no',
      'Permite Cambiar Precio POS': extended.allow_pos_price_override ? 'sí' : 'no',
      'Usa Listas de Precio': extended.has_multiple_price_tiers ? 'sí' : 'no',
      Peso: extended.weight ?? 0,
      'En Oferta': p.is_on_sale ? 'sí' : 'no',
      'Precio Oferta': extended.sale_price ?? 0,
    };
  });
  const ws = rowsToSheet(rows, PRODUCT_TEMPLATE_HEADERS);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plantilla Productos');
  const base64 = workbookToBase64(wb);
  await shareBase64(base64, `productos_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/**
 * Re-export de headers para tests/debug.
 */
export const BULK_PRODUCT_TEMPLATE_HEADERS = PRODUCT_TEMPLATE_HEADERS;
export const BULK_SERVICE_TEMPLATE_HEADERS = SERVICE_TEMPLATE_HEADERS;