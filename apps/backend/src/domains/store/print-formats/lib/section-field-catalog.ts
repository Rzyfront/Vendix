/**
 * Catálogo rico de campos por `section.type`.
 *
 * Fuente: `StandardPrintDataModel` + lo que el compositor realmente lee
 * (`print-layout-composer.service.ts`). Existe porque las plantillas de
 * sistema declaran secciones SIN `fields` (solo `pos_sale_ticket` los trae),
 * y el editor solo pintaba `section.fields` guardados: sin catálogo, la
 * factura electrónica no mostraba nada elegible.
 *
 * Regla de paridad: sección sin `fields` sigue renderizando como hoy
 * (`isFieldActive` devuelve true). El catálogo solo alimenta al editor para
 * DERIVAR la lista visible (unión guardados + catálogo) y al seeder para
 * backfills. Nunca cambia el render por sí solo.
 */

export interface SectionFieldCatalogEntry {
  /** id estable para `field.id` cuando la tienda lo activa. */
  id: string;
  /** Path resolvible contra `StandardPrintDataModel` o alias legacy `order.*`. */
  key: string;
  label: string;
  format?: 'text' | 'number' | 'currency' | 'date' | 'percent';
  position?: 'left' | 'center' | 'right' | 'full';
}

// Sin `f_logo`: el logo vive en `definition.logo` (panel de logo), no en
// secciones. Ofrecerlo como fila de texto pintaba la URL cruda junto a la
// imagen real. El compositor sí respeta el `f_logo` ya guardado en
// plantillas viejas como on/off de la imagen.
const HEADER_FIELDS: SectionFieldCatalogEntry[] = [
  { id: 'f_name', key: 'store.name', label: 'Nombre Comercial', format: 'text', position: 'center' },
  { id: 'f_legal', key: 'store.legal_name', label: 'Razón Social', format: 'text', position: 'center' },
  { id: 'f_nit', key: 'store.tax_id', label: 'NIT / RUT', format: 'text', position: 'center' },
  { id: 'f_regime', key: 'store.tax_regime', label: 'Régimen Fiscal', format: 'text', position: 'center' },
  { id: 'f_resp', key: 'store.fiscal_responsibilities', label: 'Responsabilidades Fiscales', format: 'text', position: 'center' },
  { id: 'f_addr', key: 'store.address', label: 'Dirección', format: 'text', position: 'center' },
  { id: 'f_addr1', key: 'store.address_line1', label: 'Dirección Línea 1', format: 'text', position: 'center' },
  { id: 'f_addr2', key: 'store.address_line2', label: 'Dirección Línea 2', format: 'text', position: 'center' },
  { id: 'f_city', key: 'store.city', label: 'Ciudad', format: 'text', position: 'center' },
  { id: 'f_state', key: 'store.state_province', label: 'Departamento', format: 'text', position: 'center' },
  { id: 'f_country', key: 'store.country', label: 'País', format: 'text', position: 'center' },
  { id: 'f_phone', key: 'store.phone', label: 'Teléfono', format: 'text', position: 'center' },
  { id: 'f_email', key: 'store.email', label: 'Email', format: 'text', position: 'center' },
];

const DOCUMENT_INFO_FIELDS: SectionFieldCatalogEntry[] = [
  { id: 'f_num', key: 'document.number', label: 'Número', format: 'text', position: 'left' },
  { id: 'f_prefix', key: 'document.prefix', label: 'Prefijo', format: 'text', position: 'left' },
  { id: 'f_date', key: 'document.date_formatted', label: 'Fecha', format: 'date', position: 'left' },
  { id: 'f_time', key: 'document.time', label: 'Hora', format: 'text', position: 'left' },
  { id: 'f_state', key: 'document.state_label', label: 'Estado', format: 'text', position: 'left' },
  { id: 'f_channel', key: 'document.channel_label', label: 'Canal de Venta', format: 'text', position: 'left' },
  { id: 'f_cashier', key: 'document.cashier_name', label: 'Cajero / Vendedor', format: 'text', position: 'left' },
  { id: 'f_terminal', key: 'document.pos_terminal', label: 'Caja / Terminal', format: 'text', position: 'right' },
  { id: 'f_customer_alias', key: 'document.customer_alias', label: 'Alias Cliente (venta rápida)', format: 'text', position: 'left' },
  { id: 'f_table', key: 'document.table_number', label: 'Mesa', format: 'text', position: 'left' },
  { id: 'f_waiter', key: 'document.waiter_name', label: 'Mesero', format: 'text', position: 'left' },
  { id: 'f_guests', key: 'document.guests_count', label: 'Nº Comensales', format: 'number', position: 'left' },
  { id: 'f_valid_until', key: 'document.valid_until_formatted', label: 'Vigencia', format: 'date', position: 'left' },
  { id: 'f_payment', key: 'document.payment_method', label: 'Medio de Pago', format: 'text', position: 'left' },
  { id: 'f_ref', key: 'document.reference_document_number', label: 'Doc. Referencia', format: 'text', position: 'left' },
  { id: 'f_carrier', key: 'document.shipping_carrier', label: 'Transportadora', format: 'text', position: 'left' },
  { id: 'f_tracking', key: 'document.shipping_tracking_number', label: 'Guía', format: 'text', position: 'left' },
  { id: 'f_origin', key: 'document.origin_location', label: 'Origen', format: 'text', position: 'left' },
  { id: 'f_dest', key: 'document.destination_location', label: 'Destino', format: 'text', position: 'left' },
];

const CUSTOMER_FIELDS: SectionFieldCatalogEntry[] = [
  { id: 'f_cname', key: 'customer.name', label: 'Nombre', format: 'text', position: 'left' },
  { id: 'f_clegal', key: 'customer.legal_name', label: 'Razón Social', format: 'text', position: 'left' },
  { id: 'f_cnit', key: 'customer.tax_id', label: 'NIT / CC', format: 'text', position: 'left' },
  { id: 'f_cregime', key: 'customer.tax_regime', label: 'Régimen', format: 'text', position: 'left' },
  { id: 'f_caddr', key: 'customer.address', label: 'Dirección', format: 'text', position: 'left' },
  { id: 'f_caddr1', key: 'customer.address_line1', label: 'Dirección Línea 1', format: 'text', position: 'left' },
  { id: 'f_caddr2', key: 'customer.address_line2', label: 'Dirección Línea 2', format: 'text', position: 'left' },
  { id: 'f_ccity', key: 'customer.city', label: 'Ciudad', format: 'text', position: 'left' },
  { id: 'f_cstate', key: 'customer.state_province', label: 'Departamento', format: 'text', position: 'left' },
  { id: 'f_ccountry', key: 'customer.country', label: 'País', format: 'text', position: 'left' },
  { id: 'f_cphone', key: 'customer.phone', label: 'Teléfono', format: 'text', position: 'left' },
  { id: 'f_cemail', key: 'customer.email', label: 'Email', format: 'text', position: 'left' },
];

const TOTALS_FIELDS: SectionFieldCatalogEntry[] = [
  { id: 'f_sub', key: 'totals.subtotal', label: 'Subtotal', format: 'currency', position: 'right' },
  { id: 'f_disc', key: 'totals.discount_total', label: 'Descuento', format: 'currency', position: 'right' },
  { id: 'f_ship', key: 'totals.shipping_total', label: 'Envío / Flete', format: 'currency', position: 'right' },
  { id: 'f_tax', key: 'totals.tax_total', label: 'Impuestos (IVA/INC)', format: 'currency', position: 'right' },
  { id: 'f_reten', key: 'totals.withholding_total', label: 'Retención', format: 'currency', position: 'right' },
  { id: 'f_tip', key: 'totals.tip_amount', label: 'Propina', format: 'currency', position: 'right' },
  { id: 'f_tot', key: 'totals.grand_total', label: 'TOTAL', format: 'currency', position: 'right' },
  { id: 'f_words', key: 'totals.grand_total_in_words', label: 'Valor en Letras', format: 'text', position: 'right' },
  { id: 'f_paym', key: 'document.payment_method', label: 'Método de Pago', format: 'text', position: 'right' },
  { id: 'f_recv', key: 'document.amount_received', label: 'Recibido', format: 'currency', position: 'right' },
  { id: 'f_chg', key: 'document.change_due', label: 'Cambio', format: 'currency', position: 'right' },
];

const FOOTER_FIELDS: SectionFieldCatalogEntry[] = [
  { id: 'f_msg', key: 'receipts.receipt_footer', label: 'Mensaje de Despedida', format: 'text', position: 'center' },
  { id: 'f_notes', key: 'document.notes', label: 'Notas del Documento', format: 'text', position: 'center' },
  { id: 'f_terms', key: 'document.terms_and_conditions', label: 'Términos y Condiciones', format: 'text', position: 'center' },
  { id: 'f_powered', key: 'system.powered_by', label: 'Firma del Sistema', format: 'text', position: 'center' },
];

const PARTIES_FIELDS: SectionFieldCatalogEntry[] = [
  ...HEADER_FIELDS,
  ...CUSTOMER_FIELDS,
  ...DOCUMENT_INFO_FIELDS.filter((f) =>
    ['f_num', 'f_prefix', 'f_date', 'f_state', 'f_valid_until', 'f_payment'].includes(f.id),
  ),
];

const TABLE_INFO_FIELDS: SectionFieldCatalogEntry[] = [
  { id: 'f_table', key: 'document.table_number', label: 'Mesa', format: 'text', position: 'left' },
  { id: 'f_waiter', key: 'document.waiter_name', label: 'Mesero', format: 'text', position: 'left' },
  { id: 'f_guests', key: 'document.guests_count', label: 'Comensales', format: 'number', position: 'left' },
];

const NOTES_FIELDS: SectionFieldCatalogEntry[] = [
  { id: 'f_notes', key: 'document.notes', label: 'Notas', format: 'text', position: 'left' },
  { id: 'f_terms', key: 'document.terms_and_conditions', label: 'Términos', format: 'text', position: 'left' },
  { id: 'f_internal', key: 'document.internal_notes', label: 'Nota Interna (no imprime)', format: 'text', position: 'left' },
];

/**
 * Catálogo por `section.type` (snake_case del compositor + alias legacy).
 * Secciones de bloque único (cufe/qr/taxes/firmas) devuelven []: se configuran
 * a nivel sección (on/off), no por campo.
 */
export const SECTION_FIELD_CATALOG: Readonly<Record<string, readonly SectionFieldCatalogEntry[]>> =
  Object.freeze({
    header: HEADER_FIELDS,
    fiscal_header: HEADER_FIELDS,
    document_info: DOCUMENT_INFO_FIELDS,
    doc_info: DOCUMENT_INFO_FIELDS,
    customer_info: CUSTOMER_FIELDS,
    fiscal_buyer_info: CUSTOMER_FIELDS,
    parties_info: PARTIES_FIELDS,
    totals_summary: TOTALS_FIELDS,
    totals: TOTALS_FIELDS,
    footer: FOOTER_FIELDS,
    table_info: TABLE_INFO_FIELDS,
    custom_notes: NOTES_FIELDS,
    validity_banner: [
      { id: 'f_valid_until', key: 'document.valid_until_formatted', label: 'Vigencia', format: 'date', position: 'left' },
      { id: 'f_state', key: 'document.state_label', label: 'Estado', format: 'text', position: 'left' },
    ],
    document_reference: [
      { id: 'f_ref', key: 'document.reference_document_number', label: 'Doc. Afectado', format: 'text', position: 'left' },
    ],
    shipping_info: [
      { id: 'f_carrier', key: 'document.shipping_carrier', label: 'Transportadora', format: 'text', position: 'left' },
      { id: 'f_tracking', key: 'document.shipping_tracking_number', label: 'Guía', format: 'text', position: 'left' },
      { id: 'f_origin', key: 'document.origin_location', label: 'Origen', format: 'text', position: 'left' },
      { id: 'f_dest', key: 'document.destination_location', label: 'Destino', format: 'text', position: 'left' },
    ],
    locations_info: [
      { id: 'f_origin', key: 'document.origin_location', label: 'Origen', format: 'text', position: 'left' },
      { id: 'f_dest', key: 'document.destination_location', label: 'Destino', format: 'text', position: 'left' },
    ],
    // Bloque único: on/off a nivel sección.
    items_table: [],
    kitchen_items: [],
    fiscal_cufe_box: [],
    cufe_box: [],
    fiscal_qr_section: [],
    qr_code: [],
    qr_block: [],
    fiscal_tax_breakdown: [],
    taxes_breakdown: [],
    signatures_box: [],
    fiscal_block: [],
  });

export function catalogFieldsForSectionType(sectionType: string): SectionFieldCatalogEntry[] {
  return [...(SECTION_FIELD_CATALOG[sectionType] ?? [])];
}
