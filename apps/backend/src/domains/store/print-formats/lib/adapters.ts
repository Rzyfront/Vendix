/**
 * [print-editor-dsk P7] — 11 `FormatAdapter` constants, one per
 * `PrintFormatTypeEnum` value.
 *
 * Each constant is a frozen `FormatAdapter` record. They are registered in
 * `FormatAdapterRegistryService` (sibling file) which the canvas, panels
 * and hub query — nothing here is mutable at runtime, so the values can
 * live in a plain TS module without a service wrapper.
 *
 * Why one file for all 11 (vs one file per adapter): the mapping lives in
 * a single location by design — P7's knowledge gap called out that the
 * adapter table is small enough to be legible in one scroll and would be
 * more obscure spread across 11 files. The contract that drives these
 * (label / category / default paper / regions / fiscal flag) is also
 * uniform; a registry pattern with a class hierarchy would add ceremony
 * without benefit at 11 entries.
 */

import type { FormatAdapter } from './format-adapter';

/**
 * Local helper: freeze the literal-typed adapter record. TypeScript
 * loses `RegionKind[]` narrowness when `Object.freeze({...})` is the
 * expression's RHS (the inference default widens arrays to `string[]`),
 * so we type each inner literal as `FormatAdapter` first and freeze
 * here. Cast on the return keeps `Readonly<FormatAdapter>` precise at
 * the call sites.
 */
function freezeAdapter<T extends FormatAdapter>(record: T): Readonly<T> {
  return Object.freeze(record);
}

/**
 * POS ticket — 80mm thermal, no fiscal block, no customer info block, no
 * QR block. The 5-region slice mirrors the smallest possible sales surface
 * a cashier needs: header, brand, items, totals, footer.
 */
export const POS_SALE_TICKET_ADAPTER = freezeAdapter({
  formatType: 'pos_sale_ticket',
  label: 'Ticket de Venta POS',
  category: 'Ventas POS',
  defaultPaper: 'thermal_80',
  availableRegions: ['header', 'logo', 'items-table', 'totals', 'footer'],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * Letter-size sales invoice (no DIAN). Full customer + company block.
 * This is the legacy "Factura de Venta" the system has emitted for years;
 * the fiscal version lives alongside it in `FISCAL_ELECTRONIC_INVOICE_ADAPTER`.
 */
export const SALES_ORDER_INVOICE_ADAPTER = freezeAdapter({
  formatType: 'sales_order_invoice',
  label: 'Factura de Venta',
  category: 'Ventas',
  defaultPaper: 'letter',
  availableRegions: [
    'header',
    'logo',
    'company-block',
    'customer-info',
    'items-table',
    'totals',
    'footer',
  ],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * Remisión / Despacho — A4 logistics document. Carries customer info but
 * no totals (the customer pays later, against the carrier's settlement).
 */
export const DISPATCH_NOTE_ADAPTER = freezeAdapter({
  formatType: 'dispatch_note',
  label: 'Remisión / Despacho',
  category: 'Logística',
  defaultPaper: 'a4',
  availableRegions: [
    'header',
    'logo',
    'customer-info',
    'items-table',
    'footer',
  ],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * Dispatch ticket — the 11th format, added by CP-DTLP-20260827 as the
 * mobile-carrier handoff slip. 80mm thermal, identical region shape to
 * POS but brand-tagged for ops (label differs in the side panel).
 */
export const DISPATCH_TICKET_ADAPTER = freezeAdapter({
  formatType: 'dispatch_ticket',
  label: 'Tiquete de Despacho',
  category: 'Logística',
  defaultPaper: 'thermal_80',
  availableRegions: [
    'header',
    'logo',
    'customer-info',
    'items-table',
    'footer',
  ],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * Cotización — letter-size pre-sale. Same region set as the sales
 * invoice because the document needs the same buyer block to be
 * quotable; the only difference vs `sales_order_invoice` is the
 * default layout (no totals block required).
 */
export const QUOTATION_ADAPTER = freezeAdapter({
  formatType: 'quotation',
  label: 'Cotización',
  category: 'Comercial',
  defaultPaper: 'letter',
  availableRegions: [
    'header',
    'logo',
    'company-block',
    'customer-info',
    'items-table',
    'totals',
    'footer',
  ],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * Commercial credit note (non-DIAN). Letter-size, mirrors
 * `sales_order_invoice` exactly — same shape, same regions.
 */
export const CREDIT_NOTE_ADAPTER = freezeAdapter({
  formatType: 'credit_note',
  label: 'Nota Crédito Comercial',
  category: 'Ventas',
  defaultPaper: 'letter',
  availableRegions: [
    'header',
    'logo',
    'company-block',
    'customer-info',
    'items-table',
    'totals',
    'footer',
  ],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * Purchase order — letter-size, no customer block (the buyer is the
 * store itself, handled by the company-block). Excludes the customer-
 * info region on purpose so the editor doesn't suggest wiring one.
 */
export const PURCHASE_ORDER_ADAPTER = freezeAdapter({
  formatType: 'purchase_order',
  label: 'Orden de Compra',
  category: 'Compras',
  defaultPaper: 'letter',
  availableRegions: [
    'header',
    'logo',
    'company-block',
    'customer-info',
    'items-table',
    'totals',
    'footer',
  ],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * Transfer note — letter-size intra-store. Smallest region surface of
 * the letter formats because the document is generated for traceability,
 * not for an external recipient. No logo, no customer, no totals.
 */
export const TRANSFER_NOTE_ADAPTER = freezeAdapter({
  formatType: 'transfer_note',
  label: 'Traslado entre Tiendas',
  category: 'Inventario',
  defaultPaper: 'letter',
  availableRegions: ['header', 'items-table', 'footer'],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * Fiscal electronic invoice (DIAN). The full region set including the
 * fiscal block (CUFE + QR + ISO 19115 fields) and the QR block (the
 * DIAN-resolution QR). Required fields list is the gate the renderer
 * uses to reject render attempts before the fiscal XML is fully built.
 */
export const FISCAL_ELECTRONIC_INVOICE_ADAPTER = freezeAdapter({
  formatType: 'fiscal_electronic_invoice',
  label: 'Factura Electrónica (DIAN)',
  category: 'Facturación',
  defaultPaper: 'letter',
  availableRegions: [
    'header',
    'fiscal-block',
    'logo',
    'company-block',
    'customer-info',
    'items-table',
    'totals',
    'qr-block',
    'footer',
  ],
  fiscal: true,
  requiredFields: ['fiscal.cufe', 'fiscal.qr_code_png_base64', 'store.tax_id'],
} as FormatAdapter);

/**
 * Fiscal credit note — mirror of the electronic invoice: same fiscal
 * constraints, same QR block, same required CUFE — only the label and
 * the type discriminator differ.
 */
export const FISCAL_CREDIT_NOTE_ADAPTER = freezeAdapter({
  formatType: 'fiscal_credit_note',
  label: 'Nota Crédito Electrónica',
  category: 'Facturación',
  defaultPaper: 'letter',
  availableRegions: [
    'header',
    'fiscal-block',
    'logo',
    'company-block',
    'customer-info',
    'items-table',
    'totals',
    'qr-block',
    'footer',
  ],
  fiscal: true,
  requiredFields: ['fiscal.cufe', 'fiscal.qr_code_png_base64', 'store.tax_id'],
} as FormatAdapter);

/**
 * Kitchen ticket — 80mm thermal, KDS handoff. Same compact region
 * surface as POS but no logo so the line cooks fast on low-end printers.
 */
export const KITCHEN_TICKET_ADAPTER = freezeAdapter({
  formatType: 'kitchen_ticket',
  label: 'Ticket de Cocina (KDS)',
  category: 'Restaurante',
  defaultPaper: 'thermal_80',
  availableRegions: ['header', 'logo', 'items-table', 'totals', 'footer'],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * [print-editor-dsk P8] — Planilla de ruta DSD. Carta vertical, logística
 * operativa. Necesita la info del cliente (paradas) por lo que incluye
 * customer-info, pero NO lleva totales fiscales porque una planilla no
 * factura — el recaudo es un agregado del del settlement.
 */
export const DISPATCH_ROUTE_ADAPTER = freezeAdapter({
  formatType: 'dispatch_route',
  label: 'Planilla de Ruta (DSD)',
  category: 'Logística',
  defaultPaper: 'letter',
  availableRegions: [
    'header',
    'logo',
    'company-block',
    'customer-info',
    'items-table',
    'totals',
    'footer',
  ],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * [print-editor-dsk P8] — Certificado de retención PRACTICADA.
 * Tributario, NO fiscal (no es DIAN), pero lleva los mismos campos
 * fiscales mínimos (NIT del tercero, base y monto retenido). El CUFE no
 * aplica: la retención no se timbra en XML.
 */
export const WITHHOLDING_PRACTICED_ADAPTER = freezeAdapter({
  formatType: 'withholding_practiced',
  label: 'Certificado Retención Practicada',
  category: 'Tributario',
  defaultPaper: 'letter',
  availableRegions: [
    'header',
    'logo',
    'company-block',
    'customer-info',
    'items-table',
    'totals',
    'footer',
  ],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * [print-editor-dsk P8] — Certificado de retención SUFRIDA. Misma forma
 * que el practicada: el documento no factura, sólo acredita el saldo a
 * favor del cliente.
 */
export const WITHHOLDING_SUFFERED_ADAPTER = freezeAdapter({
  formatType: 'withholding_suffered',
  label: 'Certificado Retención Sufrida',
  category: 'Tributario',
  defaultPaper: 'letter',
  availableRegions: [
    'header',
    'logo',
    'company-block',
    'customer-info',
    'items-table',
    'totals',
    'footer',
  ],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/**
 * [print-editor-dsk P8] — Certificado laboral al empleado. Misma forma
 * que los otros dos retenciones, distinta categoría funcional.
 */
export const WITHHOLDING_EMPLOYEE_CERTIFICATE_ADAPTER = freezeAdapter({
  formatType: 'withholding_employee_certificate',
  label: 'Certificado Laboral Empleado',
  category: 'Tributario',
  defaultPaper: 'letter',
  availableRegions: [
    'header',
    'logo',
    'company-block',
    'customer-info',
    'items-table',
    'totals',
    'footer',
  ],
  fiscal: false,
  requiredFields: [],
} as FormatAdapter);

/** Frozen tuple — the registry consumes this order directly. */
export const ALL_ADAPTERS: ReadonlyArray<Readonly<FormatAdapter>> = Object.freeze([
  POS_SALE_TICKET_ADAPTER,
  SALES_ORDER_INVOICE_ADAPTER,
  DISPATCH_NOTE_ADAPTER,
  DISPATCH_TICKET_ADAPTER,
  QUOTATION_ADAPTER,
  CREDIT_NOTE_ADAPTER,
  PURCHASE_ORDER_ADAPTER,
  TRANSFER_NOTE_ADAPTER,
  FISCAL_ELECTRONIC_INVOICE_ADAPTER,
  FISCAL_CREDIT_NOTE_ADAPTER,
  KITCHEN_TICKET_ADAPTER,
  // [print-editor-dsk P8] — Adaptadores 12–15 del Hub.
  DISPATCH_ROUTE_ADAPTER,
  WITHHOLDING_PRACTICED_ADAPTER,
  WITHHOLDING_SUFFERED_ADAPTER,
  WITHHOLDING_EMPLOYEE_CERTIFICATE_ADAPTER,
]);
