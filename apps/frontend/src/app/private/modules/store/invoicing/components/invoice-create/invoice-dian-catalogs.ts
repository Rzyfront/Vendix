import { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { DIAN_DOCUMENT_TYPE_SCHEME_IDS } from '../../../../../../shared/constants/dian-document-types.constants';

/**
 * CATÁLOGOS DIAN DE LA SUPERFICIE AVANZADA DE FACTURACIÓN.
 *
 * Todos son ESPEJOS de tablas que ya viven en el backend. Se copian —y no se
 * piden por HTTP— porque son estáticos y porque la alternativa (dejar que cada
 * pantalla invente su propia lista) es justamente lo que produce un `400` por
 * `forbidNonWhitelisted` o, peor, un código que la DIAN no reconoce y que
 * rechaza el documento después de haber gastado el consecutivo.
 *
 * Fuente de cada tabla, para que la deriva se pueda auditar:
 *
 *  · `INVOICE_TYPE_OPTIONS`  → `CreateInvoiceDto.invoice_type` (`@IsEnum`).
 *  · `PAYMENT_FORM_OPTIONS`  → `FormasPago-2.1.gc` (`@IsIn(['1','2'])`).
 *  · `PAYMENT_MEANS_OPTIONS` → `DIAN_PAYMENT_MEANS` del proveedor UBL.
 *  · `OPERATION_TYPE_OPTIONS`→ `@IsIn(['10','09','11','12'])`.
 *  · `DOCUMENT_TYPE_OPTIONS` → `DIAN_DOCUMENT_TYPE_SCHEME_IDS` (Anexo 19).
 *  · `UNIT_CODE_OPTIONS`     → UN/ECE rec. 20 (`cbc:InvoicedQuantity/@unitCode`).
 *  · `FOREIGN_CURRENCY_OPTIONS` → ISO 4217.
 */

// ─────────────────────────────────────────────────────────────
// Tipo de documento a emitir
// ─────────────────────────────────────────────────────────────

/**
 * Los DOS tipos que esta superficie emite.
 *
 * `purchase_invoice` se retiró de la lista a propósito. El DTO lo acepta, pero
 * el servicio lo trata como documento soporte y exige `supplier_id`
 * (`loadSupportDocumentSupplier` lanza `FISCAL_CONFIG_INCOMPLETE` sin él): este
 * formulario no captura proveedor, así que ofrecerlo era ofrecer un botón cuyo
 * único desenlace posible es un error. El documento soporte tiene su propia
 * pantalla (`support-document-create`), que sí captura proveedor.
 *
 * Lo mismo para `pos_equivalent_document` y las notas de ajuste: se emiten desde
 * la caja y desde el detalle de la factura, no desde aquí.
 */
export const INVOICE_TYPE_OPTIONS: SelectorOption[] = [
  {
    value: 'sales_invoice',
    label: 'Factura de venta',
    description: 'FEV — numeración autorizada por la DIAN',
  },
  {
    value: 'export_invoice',
    label: 'Factura de exportación',
    description: 'Numera con el mismo rango de la factura de venta',
  },
];

/**
 * `invoice_type` → tipo de documento fiscal con el que el backend busca la
 * resolución. ESPEJO EXACTO de `InvoicingService.toFiscalDocumentType()`; es lo
 * que permite que el banner enseñe la MISMA resolución que se va a consumir.
 */
export function toFiscalDocumentType(invoiceType: string): string {
  if (invoiceType === 'purchase_invoice') return 'support_document';
  if (invoiceType === 'export_invoice') return 'sales_invoice';
  return invoiceType;
}

/** Nombre legible del tipo, para el banner de resolución. */
export function invoiceTypeLabel(invoiceType: string): string {
  const option = INVOICE_TYPE_OPTIONS.find((o) => o.value === invoiceType);
  return option?.label ?? 'Factura de venta';
}

/**
 * Clasificaciones fiscales que el backend acepta en `CreateInvoiceTaxDto.tax_type`
 * (`@IsEnum(TaxFiscalType)`). Se valida ANTES de enviar: un `tax_type` fuera de
 * este conjunto —una categoría vieja con el campo en `null` o con un valor
 * heredado— produce un 400 que nombra un campo que el usuario nunca vio.
 */
export const TAX_FISCAL_TYPES: ReadonlySet<string> = new Set([
  'iva',
  'inc',
  'ica',
  'withholding',
  'reteiva',
  'reteica',
]);

/** `tax_type` seguro de enviar, o `undefined` para que el backend asuma IVA. */
export function safeTaxType(
  value: string | null | undefined,
): string | undefined {
  return value && TAX_FISCAL_TYPES.has(value) ? value : undefined;
}

// ─────────────────────────────────────────────────────────────
// Forma y medio de pago
// ─────────────────────────────────────────────────────────────

/** `'2'` (crédito) es el único valor que vuelve obligatorio el vencimiento. */
export const PAYMENT_FORM_CREDIT = '2';
export const PAYMENT_FORM_CASH = '1';

export const PAYMENT_FORM_OPTIONS: SelectorOption[] = [
  {
    value: PAYMENT_FORM_CASH,
    label: 'Contado',
    description: 'Vence el mismo día de la emisión',
  },
  {
    value: PAYMENT_FORM_CREDIT,
    label: 'Crédito',
    description: 'Exige fecha de vencimiento',
  },
];

/**
 * Medios de pago con nombre. La tabla completa son 75 códigos; estos son los que
 * cubren el tráfico real de un comercio colombiano. Quien necesite otro lo
 * escribe: el DTO valida sólo la longitud (≤3), no la pertenencia al subconjunto.
 */
export const PAYMENT_MEANS_OPTIONS: SelectorOption[] = [
  { value: '10', label: 'Efectivo' },
  { value: '20', label: 'Cheque' },
  { value: '42', label: 'Consignación bancaria' },
  { value: '47', label: 'Transferencia débito bancaria' },
  { value: '45', label: 'Transferencia crédito bancaria' },
  { value: '48', label: 'Tarjeta de crédito' },
  { value: '49', label: 'Tarjeta débito' },
  { value: '30', label: 'Transferencia crédito' },
  { value: '1', label: 'Instrumento no definido' },
  { value: 'ZZZ', label: 'Acuerdo mutuo entre las partes' },
];

// ─────────────────────────────────────────────────────────────
// Tipo de operación (cbc:CustomizationID)
// ─────────────────────────────────────────────────────────────

/** AIU. El contrato se factura en porciones A/I/U y la base gravable la declara el perfil. */
export const OPERATION_TYPE_AIU = '09';
export const OPERATION_TYPE_STANDARD = '10';

export const OPERATION_TYPE_OPTIONS: SelectorOption[] = [
  {
    value: OPERATION_TYPE_STANDARD,
    label: 'Estándar (10)',
    description: 'La base gravable es el valor de cada línea',
  },
  {
    value: OPERATION_TYPE_AIU,
    label: 'AIU (09)',
    description: 'Contrato por porciones A/I/U; la base gravable la declara el perfil',
  },
  {
    value: '11',
    label: 'Mandatos (11)',
    description: 'Operación por cuenta de un tercero',
  },
  {
    value: '12',
    label: 'Transporte (12)',
    description: 'Servicio de transporte',
  },
];

/** Componentes AIU tal como los nombra `CreateInvoiceItemDto.aiu_component`. */
export const AIU_COMPONENT_OPTIONS: SelectorOption[] = [
  { value: 'administracion', label: 'Administración' },
  { value: 'imprevistos', label: 'Imprevistos' },
  { value: 'utilidad', label: 'Utilidad' },
];

// ─────────────────────────────────────────────────────────────
// Identificación del adquiriente
// ─────────────────────────────────────────────────────────────

/**
 * Etiqueta legible de cada sigla interna. Los CÓDIGOS no se escriben aquí: se
 * derivan de `DIAN_DOCUMENT_TYPE_SCHEME_IDS`, que ya es el espejo del catálogo
 * del backend. Dos listas del mismo catálogo siempre divergen, y la que se
 * equivoca aquí manda un `@schemeID` que le amputa el dígito de verificación a
 * una cédula.
 */
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  CC: 'Cédula de ciudadanía',
  NIT: 'NIT',
  CE: 'Cédula de extranjería',
  TI: 'Tarjeta de identidad',
  RC: 'Registro civil',
  PA: 'Pasaporte',
  PEP: 'Permiso especial de permanencia',
  PPT: 'Permiso por protección temporal',
  DIE: 'Documento de identificación extranjero',
  NUIP: 'NUIP',
};

/** Orden deliberado: los tres frecuentes primero. */
const DOCUMENT_TYPE_ORDER = [
  'CC',
  'NIT',
  'CE',
  'TI',
  'RC',
  'PA',
  'PEP',
  'PPT',
  'DIE',
  'NUIP',
];

export const DOCUMENT_TYPE_OPTIONS: SelectorOption[] = DOCUMENT_TYPE_ORDER.map(
  (sigla) => ({
    value: DIAN_DOCUMENT_TYPE_SCHEME_IDS[sigla],
    label: DOCUMENT_TYPE_LABELS[sigla],
    description: sigla + ' · código ' + DIAN_DOCUMENT_TYPE_SCHEME_IDS[sigla],
  }),
).filter((option) => !!option.value);

/** Código DIAN del NIT. Es el ÚNICO tipo que lleva dígito de verificación. */
export const DOCUMENT_TYPE_NIT_CODE = DIAN_DOCUMENT_TYPE_SCHEME_IDS['NIT'];

/** `users.tax_regime` (`TaxRegime`), tal como lo captura el modal de clientes. */
export const TAX_REGIME_OPTIONS: SelectorOption[] = [
  { value: 'COMUN', label: 'Común' },
  { value: 'SIMPLIFICADO', label: 'Simplificado' },
  { value: 'GRAN_CONTRIBUYENTE', label: 'Gran contribuyente' },
  { value: 'AUTORRETENEDOR', label: 'Autorretenedor' },
  { value: 'ESPECIAL', label: 'Régimen especial' },
  { value: 'NO_APLICA', label: 'No aplica' },
];

// ─────────────────────────────────────────────────────────────
// Unidades de medida (UN/ECE rec. 20)
// ─────────────────────────────────────────────────────────────

export const UNIT_CODE_DEFAULT = 'NIU';

/**
 * `UNIT_CODE_OPTIONS` se mudó a `shared/components/invoice-sections/` cuando la
 * consola de plataforma necesitó el MISMO catálogo: dos superficies emiten
 * facturas y no se importan entre sí, así que la lista no puede vivir dentro
 * del riel de una de las dos. Se re-exporta desde aquí para no tocar a los
 * consumidores que ya la importaban de este archivo.
 */
export { UNIT_CODE_OPTIONS } from '../../../../../../shared/components/invoice-sections/invoice-dian-catalogs';

// ─────────────────────────────────────────────────────────────
// Divisa extranjera (ISO 4217)
// ─────────────────────────────────────────────────────────────

/**
 * LA FACTURA SE EMITE SIEMPRE EN PESOS. Esta lista alimenta
 * `foreign_currency`, que sólo DECLARA la conversión
 * (`cac:PaymentAlternativeExchangeRate`); `currency` se queda en COP porque así
 * lo exige la Res. DIAN 000042/2020 art. 73 y así lo persiste el backend
 * (`currency: dto.currency || 'COP'`).
 */
export const FOREIGN_CURRENCY_OPTIONS: SelectorOption[] = [
  { value: 'USD', label: 'USD — Dólar estadounidense' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — Libra esterlina' },
  { value: 'CAD', label: 'CAD — Dólar canadiense' },
  { value: 'MXN', label: 'MXN — Peso mexicano' },
  { value: 'BRL', label: 'BRL — Real brasileño' },
  { value: 'ARS', label: 'ARS — Peso argentino' },
  { value: 'CLP', label: 'CLP — Peso chileno' },
  { value: 'PEN', label: 'PEN — Sol peruano' },
  { value: 'CHF', label: 'CHF — Franco suizo' },
  { value: 'JPY', label: 'JPY — Yen japonés' },
  { value: 'CNY', label: 'CNY — Yuan chino' },
  { value: 'AUD', label: 'AUD — Dólar australiano' },
];
