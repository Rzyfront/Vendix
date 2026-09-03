/**
 * [print-editor-dsk P7] — Default paper lookup for each format_type.
 *
 * Kept as a tiny standalone module (instead of a service) because the
 * adapter registry already wraps it for callers; this file just owns the
 * static table and a `defaults to 'letter'` fallback so an unknown
 * `format_type` — e.g. an enum value the running schema hasn't learned
 * about yet — still resolves to a renderable paper rather than throwing.
 *
 * Why keep the lookup table here (vs in `adapters.ts`): every other
 * consumer that needs a format's default paper also imports
 * `defaultPaperFor()` directly without going through the registry —
 * `print-document-renderer.service.ts`'s callers, doc-driven previews,
 * migration scripts. Putting it on the adapter registry would force a
 * Nest DI lookup for callers that aren't inside a request scope.
 */

import type { PrintFormatType } from './format-adapter';
import { getPaperGeometry, type PaperFormat } from './page-geometry';

/**
 * Mirror of the table the adapter constants expose. Kept in lockstep
 * with the `defaultPaper` field on each entry of `ALL_ADAPTERS` —
 * adding a new `PrintFormatTypeEnum` value requires both to agree.
 */
const DEFAULTS: Record<string, PaperFormat> = Object.freeze({
  pos_sale_ticket: 'thermal_80',
  // Factura electrónica POS: misma tirilla térmica de 80mm que el ticket de
  // venta, con el bloque fiscal (CUFE/QR) encima. `ALL_ADAPTERS` ya lo tenía
  // (`POS_ELECTRONIC_INVOICE_ADAPTER.defaultPaper`) — faltaba aquí, así que
  // `defaultPaperFor('pos_electronic_invoice')` caía al `'letter'` del
  // fallback y una tienda sin `store_print_format_configs` propio recibía el
  // papel equivocado en el primer render.
  pos_electronic_invoice: 'thermal_80',
  sales_order_invoice: 'letter',
  dispatch_note: 'a4',
  dispatch_ticket: 'thermal_80',
  quotation: 'letter',
  credit_note: 'letter',
  purchase_order: 'letter',
  transfer_note: 'letter',
  fiscal_electronic_invoice: 'letter',
  fiscal_credit_note: 'letter',
  kitchen_ticket: 'thermal_80',
  // [print-editor-dsk P8] — Lote 12–15: planilla de ruta DSD (carta, igual
  // que `dispatch_note`) + tres certificados de retención (carta).
  dispatch_route: 'letter',
  withholding_practiced: 'letter',
  withholding_suffered: 'letter',
  withholding_employee_certificate: 'letter',
});

/**
 * Resolve the default paper for a given format type. Falls back to
 * `'letter'` for any value not in `DEFAULTS` so an unknown enum value
 * (e.g. a stale `@prisma/client` after a migration) still produces a
 * renderable, safe geometry.
 */
export function defaultPaperFor(formatType: PrintFormatType): PaperFormat {
  return DEFAULTS[formatType] ?? 'letter';
}

/**
 * Convenience: the geometry record (`width_mm`, `css_page_size`, etc.)
 * for the format's default paper. Saves callers from chaining the
 * lookup themselves.
 */
export function defaultGeometryFor(formatType: PrintFormatType) {
  return getPaperGeometry(defaultPaperFor(formatType));
}
