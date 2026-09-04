import { PrintFieldDefinition } from '../../../../../../core/models/print-formats.model';

/**
 * Mirror FE del catálogo BE (`print-formats/lib/section-field-catalog.ts`).
 * El editor deriva la lista visible como unión guardados + catálogo para que
 * formatos sin `fields` sembrados (factura electrónica, etc.) igual ofrezcan
 * todo el dato elegible. Mantener sincronizado a mano: no hay workspace package.
 */

export interface CatalogField extends Pick<
  PrintFieldDefinition,
  'id' | 'key' | 'label' | 'format' | 'position'
> {}

// Sin `f_logo`: el logo vive en `definition.logo` (panel de logo), no en
// secciones. Ofrecerlo como fila de texto pintaba la URL cruda junto a la
// imagen real.
const HEADER: CatalogField[] = [
  { id: 'f_name', key: 'store.name', label: 'Nombre Comercial', format: 'text', position: 'center' },
  { id: 'f_legal', key: 'store.legal_name', label: 'Razón Social', format: 'text', position: 'center' },
  { id: 'f_nit', key: 'store.tax_id', label: 'NIT / RUT', format: 'text', position: 'center' },
  { id: 'f_regime', key: 'store.tax_regime', label: 'Régimen Fiscal', format: 'text', position: 'center' },
  { id: 'f_addr', key: 'store.address', label: 'Dirección', format: 'text', position: 'center' },
  { id: 'f_addr1', key: 'store.address_line1', label: 'Dirección Línea 1', format: 'text', position: 'center' },
  { id: 'f_addr2', key: 'store.address_line2', label: 'Dirección Línea 2', format: 'text', position: 'center' },
  { id: 'f_city', key: 'store.city', label: 'Ciudad', format: 'text', position: 'center' },
  { id: 'f_state', key: 'store.state_province', label: 'Departamento', format: 'text', position: 'center' },
  { id: 'f_country', key: 'store.country', label: 'País', format: 'text', position: 'center' },
  { id: 'f_phone', key: 'store.phone', label: 'Teléfono', format: 'text', position: 'center' },
  { id: 'f_email', key: 'store.email', label: 'Email', format: 'text', position: 'center' },
];

const DOC_INFO: CatalogField[] = [
  { id: 'f_num', key: 'document.number', label: 'Número', format: 'text', position: 'left' },
  { id: 'f_prefix', key: 'document.prefix', label: 'Prefijo', format: 'text', position: 'left' },
  { id: 'f_date', key: 'document.date_formatted', label: 'Fecha', format: 'date', position: 'left' },
  { id: 'f_time', key: 'document.time', label: 'Hora', format: 'text', position: 'left' },
  { id: 'f_state', key: 'document.state_label', label: 'Estado', format: 'text', position: 'left' },
  { id: 'f_channel', key: 'document.channel_label', label: 'Canal de Venta', format: 'text', position: 'left' },
  { id: 'f_cashier', key: 'document.cashier_name', label: 'Cajero / Vendedor', format: 'text', position: 'left' },
  { id: 'f_terminal', key: 'document.pos_terminal', label: 'Caja / Terminal', format: 'text', position: 'right' },
  { id: 'f_customer_alias', key: 'document.customer_alias', label: 'Alias Cliente', format: 'text', position: 'left' },
  { id: 'f_customer_alias', key: 'document.customer_alias', label: 'Alias Cliente', format: 'text', position: 'left' },
  { id: 'f_table', key: 'document.table_number', label: 'Mesa', format: 'text', position: 'left' },
  { id: 'f_waiter', key: 'document.waiter_name', label: 'Mesero', format: 'text', position: 'left' },
  { id: 'f_guests', key: 'document.guests_count', label: 'Comensales', format: 'number', position: 'left' },
  { id: 'f_valid_until', key: 'document.valid_until_formatted', label: 'Vigencia', format: 'date', position: 'left' },
  { id: 'f_payment', key: 'document.payment_method', label: 'Medio de Pago', format: 'text', position: 'left' },
  { id: 'f_ref', key: 'document.reference_document_number', label: 'Doc. Referencia', format: 'text', position: 'left' },
  { id: 'f_carrier', key: 'document.shipping_carrier', label: 'Transportadora', format: 'text', position: 'left' },
  { id: 'f_tracking', key: 'document.shipping_tracking_number', label: 'Guía', format: 'text', position: 'left' },
  { id: 'f_origin', key: 'document.origin_location', label: 'Origen', format: 'text', position: 'left' },
  { id: 'f_dest', key: 'document.destination_location', label: 'Destino', format: 'text', position: 'left' },
];

const CUSTOMER: CatalogField[] = [
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

const TOTALS: CatalogField[] = [
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

const FOOTER: CatalogField[] = [
  { id: 'f_msg', key: 'receipts.receipt_footer', label: 'Mensaje de Despedida', format: 'text', position: 'center' },
  { id: 'f_notes', key: 'document.notes', label: 'Notas del Documento', format: 'text', position: 'center' },
  { id: 'f_terms', key: 'document.terms_and_conditions', label: 'Términos y Condiciones', format: 'text', position: 'center' },
  { id: 'f_powered', key: 'system.powered_by', label: 'Firma del Sistema', format: 'text', position: 'center' },
];

export const SECTION_FIELD_CATALOG: Readonly<Record<string, readonly CatalogField[]>> = Object.freeze({
  header: HEADER,
  fiscal_header: HEADER,
  document_info: DOC_INFO,
  doc_info: DOC_INFO,
  customer_info: CUSTOMER,
  fiscal_buyer_info: CUSTOMER,
  parties_info: [...HEADER, ...CUSTOMER, ...DOC_INFO.filter((f) => ['f_num', 'f_date', 'f_state'].includes(f.id))],
  totals_summary: TOTALS,
  totals: TOTALS,
  footer: FOOTER,
  table_info: [
    { id: 'f_table', key: 'document.table_number', label: 'Mesa', format: 'text', position: 'left' },
    { id: 'f_waiter', key: 'document.waiter_name', label: 'Mesero', format: 'text', position: 'left' },
    { id: 'f_guests', key: 'document.guests_count', label: 'Comensales', format: 'number', position: 'left' },
  ],
  custom_notes: [
    { id: 'f_notes', key: 'document.notes', label: 'Notas', format: 'text', position: 'left' },
    { id: 'f_terms', key: 'document.terms_and_conditions', label: 'Términos', format: 'text', position: 'left' },
  ],
  validity_banner: [
    { id: 'f_valid_until', key: 'document.valid_until_formatted', label: 'Vigencia', format: 'date', position: 'left' },
    { id: 'f_state', key: 'document.state_label', label: 'Estado', format: 'text', position: 'left' },
  ],
  document_reference: [{ id: 'f_ref', key: 'document.reference_document_number', label: 'Doc. Afectado', format: 'text', position: 'left' }],
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

export function catalogFieldsForSectionType(sectionType: string): CatalogField[] {
  return [...(SECTION_FIELD_CATALOG[sectionType] ?? [])];
}

/**
 * Ids que el compositor pinta aunque la sección no traiga `fields`
 * (hardcoded por `section.type`). El editor los muestra como "Por defecto":
 * al apagarlos se persisten con `enabled:false` en vez de duplicarse.
 */
const DEFAULT_IDS_BY_TYPE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  header: ['f_logo', 'f_name', 'f_legal', 'f_nit', 'f_regime', 'f_addr', 'f_phone'],
  fiscal_header: ['f_logo', 'f_name', 'f_legal', 'f_nit', 'f_regime', 'f_addr', 'f_phone'],
  document_info: ['f_num', 'f_date', 'f_cashier', 'f_terminal', 'f_customer_alias'],
  doc_info: ['f_num', 'f_date', 'f_cashier', 'f_terminal', 'f_customer_alias'],
  customer_info: ['f_cname', 'f_cnit', 'f_caddr', 'f_cphone', 'f_cemail'],
  fiscal_buyer_info: ['f_cname', 'f_cnit', 'f_caddr', 'f_cphone', 'f_cemail'],
  parties_info: ['f_name', 'f_nit', 'f_addr', 'f_phone', 'f_cname', 'f_cnit', 'f_caddr', 'f_cemail', 'f_num', 'f_date', 'f_state'],
  totals_summary: ['f_sub', 'f_disc', 'f_tax', 'f_tot', 'f_paym', 'f_chg'],
  totals: ['f_sub', 'f_disc', 'f_tax', 'f_tot', 'f_paym', 'f_chg'],
  footer: ['f_msg', 'f_powered'],
});

const LOGO_DEFAULT: CatalogField = { id: 'f_logo', key: 'store.logo_url', label: 'Logo (imagen)', format: 'text', position: 'center' };

export function defaultFieldsForSectionType(sectionType: string): CatalogField[] {
  const ids = DEFAULT_IDS_BY_TYPE[sectionType] ?? [];
  const catalog = catalogFieldsForSectionType(sectionType);
  return ids.map((id) => catalog.find((c) => c.id === id) ?? (id === 'f_logo' ? { ...LOGO_DEFAULT } : null)).filter((f): f is CatalogField => f !== null);
}

/** Unión guardados + catálogo: lo guardado manda, lo faltante entra apagado. Match por `id` para tolerar alias legacy de `key` (`order.*` vs `document.*`). */
export function mergeSectionFields(
  stored: Array<{ id: string; key: string }> | undefined,
  sectionType: string,
): CatalogField[] {
  const catalog = catalogFieldsForSectionType(sectionType);
  if (!stored || stored.length === 0) return catalog.map((c) => ({ ...c }));
  const seenIds = new Set(stored.map((f) => f.id));
  const missing = catalog.filter((c) => !seenIds.has(c.id));
  return [...missing.map((c) => ({ ...c }))];
}
