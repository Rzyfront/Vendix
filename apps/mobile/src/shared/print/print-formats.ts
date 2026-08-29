/**
 * Mobile mirror of the print contract that already lives in the backend
 * (`apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts`)
 * and in the web client
 * (`apps/frontend/src/app/core/models/store-settings.interface.ts`).
 *
 * It is a COPY on purpose: `mobile-dev` RULE 4 forbids importing across apps,
 * and there is no shared library that owns this contract today. Every value
 * here must stay byte-identical to those two files — a format the mobile does
 * not know about would silently fall back to the document default and print on
 * the wrong paper, which is exactly the defect QUI-665 is about.
 */

/**
 * Closed set on purpose: the graphic representation of an invoice carries
 * mandatory content (issuer legal data, CUFE, QR), so the format changes the
 * box, never the contents. `thermal_*` are roll widths in millimetres.
 */
export const PRINT_FORMATS = [
  'letter',
  'half_letter',
  'a4',
  'thermal_80',
  'thermal_58',
] as const;

export type PrintFormat = (typeof PRINT_FORMATS)[number];

export const PRINT_FORMAT_LABELS: Record<PrintFormat, string> = {
  letter: 'Carta (216 × 279 mm)',
  half_letter: 'Media carta (216 × 140 mm)',
  a4: 'A4 (210 × 297 mm)',
  thermal_80: 'Rollo térmico 80 mm',
  thermal_58: 'Rollo térmico 58 mm',
};

/**
 * Every document the application can print, as its own configurable unit: the
 * configurable unit is the store × the document type, not the store alone.
 */
export const PRINT_DOCUMENTS = [
  'pos_ticket',
  'invoice',
  'dispatch_ticket',
  'dispatch_note',
  'dispatch_route',
  'sales_order',
  'purchase_order',
  'quotation',
  'reservation',
  'layaway',
  'guest_order',
  'withholding_certificate',
] as const;

export type PrintDocument = (typeof PRINT_DOCUMENTS)[number];

export const PRINT_DOCUMENT_LABELS: Record<PrintDocument, string> = {
  pos_ticket: 'Tiquete POS',
  invoice: 'Factura electrónica',
  dispatch_ticket: 'Tiquete de despacho',
  dispatch_note: 'Remisión',
  dispatch_route: 'Planilla de ruta',
  sales_order: 'Orden de venta',
  purchase_order: 'Orden de compra',
  quotation: 'Cotización',
  reservation: 'Reserva',
  layaway: 'Separado',
  guest_order: 'Pedido de invitado',
  withholding_certificate: 'Certificado de retención',
};

export interface PrintDocumentConfig {
  format: PrintFormat;
  /** Page margin in millimetres. Ignored on roll formats. */
  margin_mm?: number;
  /** Printed copies. 0 = do not print. */
  copies?: number;
}

/**
 * Per-store, per-document print configuration. Scope is the STORE: nothing is
 * inherited from the organization. Absent entries fall back to
 * `PRINT_DEFAULTS`.
 */
export type PrintingSettings = Partial<
  Record<PrintDocument, PrintDocumentConfig>
>;

export const PRINT_DEFAULTS: Record<PrintDocument, PrintDocumentConfig> = {
  pos_ticket: { format: 'thermal_80', copies: 1 },
  invoice: { format: 'thermal_80', copies: 1 },
  dispatch_ticket: { format: 'thermal_80', copies: 1 },
  dispatch_note: { format: 'a4', margin_mm: 20, copies: 1 },
  dispatch_route: { format: 'a4', margin_mm: 8, copies: 1 },
  sales_order: { format: 'a4', margin_mm: 20, copies: 1 },
  purchase_order: { format: 'a4', margin_mm: 20, copies: 1 },
  quotation: { format: 'a4', margin_mm: 20, copies: 1 },
  reservation: { format: 'a4', margin_mm: 20, copies: 1 },
  layaway: { format: 'a4', margin_mm: 20, copies: 1 },
  guest_order: { format: 'a4', margin_mm: 20, copies: 1 },
  withholding_certificate: { format: 'a4', margin_mm: 20, copies: 1 },
};

/**
 * Page geometry per format. `page_size` is the CSS `@page size` rule; without
 * it the renderer falls back to its own default paper and centres an 80 mm
 * ticket on a letter sheet.
 *
 * `height_mm` is the mobile-only addition: expo-print takes the page box in
 * POINTS rather than reading `@page`, so the millimetres have to be converted
 * (`mmToPoints`) and handed over explicitly. `null` marks a continuous roll —
 * the sheet grows with the content, so no height is imposed.
 *
 * [print-editor-dsk P1.6] Re-exportado del shim local `./lib/page-geometry`
 * para mantener sincronía byte-a-byte con backend y frontend. La fuente única
 * es `libs/print-formats/schemas/page-geometry.json` y el script
 * `scripts/sync-print-geometry.ts` la copia a cada app.
 */
export { PRINT_PAGE_GEOMETRY } from './lib/page-geometry';

/** PostScript points per millimetre (72 pt per inch, 25.4 mm per inch). */
const POINTS_PER_MM = 72 / 25.4;

/**
 * Millimetres to the points expo-print expects in `width`/`height`. Its docs
 * call them "pixels", but the defaults it documents (612 × 792 for US Letter)
 * are 72-PPI points.
 */
export function mmToPoints(mm: number): number {
  return Math.round(mm * POINTS_PER_MM);
}
