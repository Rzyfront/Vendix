import {
  PRINT_DOCUMENTS,
  PRINT_DOCUMENT_LABELS,
  PrintDocument,
  PrintFormat,
} from '../../../../../../../core/models/store-settings.interface';

/**
 * Presentation layer of the print settings screen: how the 12 documents of
 * `PRINT_DOCUMENTS` are grouped, what each one is called in one glance, and when
 * the application actually prints it.
 *
 * Kept apart from the component because it is editorial content, not behaviour:
 * the merchant configures paper for documents whose names alone do not say when
 * they come out of the printer ("Separado", "Tiquete de despacho"), and the only
 * way to choose a format sensibly is knowing which moment it belongs to.
 *
 * `PRINT_DOCUMENTS` remains the authority. This file only groups it.
 */

/** Short chip labels. `PRINT_FORMAT_LABELS` carries the millimetres inline, which
 * is redundant next to a silhouette that already draws them and too long for a
 * chip. */
export const PRINT_FORMAT_SHORT_LABELS: Record<PrintFormat, string> = {
  letter: 'Carta',
  half_letter: 'Media carta',
  a4: 'A4',
  thermal_80: 'Rollo 80',
  thermal_58: 'Rollo 58',
};

/**
 * When each document is printed, in plain Spanish.
 *
 * Written from the real emitters, not from the document's name: every entry
 * below matches a caller that hands this document to `DocumentPrintService`
 * (`*-print.service.ts` per module, `PosTicketService` for the ticket) or, for
 * `dispatch_route` and `invoice`, a backend builder that resolves the same
 * per-store configuration.
 */
export const PRINT_DOCUMENT_WHEN: Record<PrintDocument, string> = {
  pos_ticket:
    'Al cerrar una venta en el POS, y cada vez que se reimprime el tiquete desde el detalle de la orden.',
  invoice:
    'Al emitir la factura electrónica y al reimprimir su representación gráfica para entregarla al cliente.',
  guest_order:
    'Cuando llega un pedido de la tienda en línea hecho sin cuenta y se imprime su comprobante.',
  dispatch_ticket:
    'Al alistar el pedido en bodega: la hoja de empaque que se revisa contra la mercancía antes de que salga.',
  dispatch_note:
    'Al generar la remisión que viaja con la mercancía y que el cliente firma cuando la recibe.',
  dispatch_route:
    'Al despachar una planilla de reparto: la hoja con todas las paradas que lleva el conductor.',
  sales_order:
    'Al confirmar un pedido de venta que todavía no se factura, para que bodega y cliente tengan lo acordado.',
  purchase_order:
    'Al enviar la orden de compra al proveedor con los productos, las cantidades y los precios pactados.',
  quotation:
    'Al entregarle una cotización al cliente, antes de que se convierta en venta.',
  reservation:
    'Al tomar una reserva de un producto o de un servicio, con su fecha y su hora.',
  layaway:
    'Al abrir un separado y en cada abono que el cliente hace sobre él.',
  withholding_certificate:
    'Al expedir el certificado de retención que el proveedor necesita para su declaración.',
};

/**
 * Documents that do not fit a roll: several columns wide, or long enough that a
 * 58 mm strip turns them into a column of fragments. Choosing a roll for them is
 * allowed — a merchant with one thermal printer and no laser is a real case —
 * but it is warned about, never blocked.
 */
export const NARROW_RISK_DOCUMENTS: ReadonlySet<PrintDocument> = new Set<
  PrintDocument
>(['dispatch_note', 'purchase_order', 'withholding_certificate']);

export interface PrintFamily {
  id: string;
  label: string;
  /** One line saying what the family has in common, so the header is not decor. */
  hint: string;
  icon: string;
  documents: readonly PrintDocument[];
}

/**
 * The three families. Grouping is by the moment the paper is used, which is what
 * decides the format: what the customer is handed at the counter tends to a
 * roll, what travels with the goods or gets filed tends to a sheet.
 */
const DECLARED_FAMILIES: readonly PrintFamily[] = [
  {
    id: 'sale',
    label: 'Venta',
    hint: 'Lo que se entrega al cliente al cobrar.',
    icon: 'receipt',
    documents: ['pos_ticket', 'invoice', 'guest_order'],
  },
  {
    id: 'logistics',
    label: 'Logística',
    hint: 'Lo que viaja con la mercancía o guía al repartidor.',
    icon: 'truck',
    documents: ['dispatch_ticket', 'dispatch_note', 'dispatch_route'],
  },
  {
    id: 'commercial',
    label: 'Comercial y documentos',
    hint: 'Lo que se envía a un tercero o queda archivado.',
    icon: 'file-text',
    documents: [
      'sales_order',
      'purchase_order',
      'quotation',
      'reservation',
      'layaway',
      'withholding_certificate',
    ],
  },
];

/** A document as the screen renders it. */
export interface PrintFamilyRow {
  doc: PrintDocument;
  label: string;
  when: string;
}

export interface PrintFamilyView extends Omit<PrintFamily, 'documents'> {
  documents: readonly PrintFamilyRow[];
}

/**
 * The families, resolved against `PRINT_DOCUMENTS`, with a safety net: any
 * document the contract declares and no family claims is appended to a trailing
 * group instead of vanishing from the screen.
 *
 * Without it, adding a 13th document to `PRINT_DOCUMENTS` would leave it
 * silently unconfigurable here while the print engine kept resolving it from
 * `PRINT_DEFAULTS` — a setting nobody can reach is worse than an ugly group.
 */
export function buildPrintFamilies(): readonly PrintFamilyView[] {
  const claimed = new Set<PrintDocument>();
  const toRow = (doc: PrintDocument): PrintFamilyRow => ({
    doc,
    label: PRINT_DOCUMENT_LABELS[doc],
    when: PRINT_DOCUMENT_WHEN[doc],
  });

  const families: PrintFamilyView[] = DECLARED_FAMILIES.map((family) => {
    const documents = family.documents.filter((doc) => {
      // A family entry that the contract no longer declares is dropped rather
      // than rendered as a row whose value nothing would ever read.
      if (!PRINT_DOCUMENTS.includes(doc)) return false;
      claimed.add(doc);
      return true;
    });
    return { ...family, documents: documents.map(toRow) };
  }).filter((family) => family.documents.length > 0);

  const orphans = PRINT_DOCUMENTS.filter((doc) => !claimed.has(doc));
  if (orphans.length) {
    families.push({
      id: 'other',
      label: 'Otros documentos',
      hint: 'Documentos que el sistema imprime y todavía no están agrupados.',
      icon: 'printer',
      documents: orphans.map(toRow),
    });
  }

  return families;
}
