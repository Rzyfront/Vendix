import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { RESOLUTION_PUBLIC_SELECT } from '../../invoicing/utils/technical-key.util';
import { amountToSpanishWords } from '@common/utils/amount-in-words.util';

/**
 * UNA sola proyección `invoices` → modelo de impresión, compartida por los dos
 * proveedores fiscales (factura y nota de crédito).
 *
 * Está extraída y no duplicada a propósito. La versión anterior tenía la
 * proyección entera dentro de `fiscal-invoice.provider.ts` y la nota de crédito
 * no la tenía en absoluto: devolvía una muestra fabricada en el camino REAL de
 * impresión (`print-gateway.service.ts:174`), o sea que imprimir una nota de
 * crédito real entregaba al cliente un documento fiscal con el NIT de un tercero
 * («Compañía Minera y Comercial del Pacífico S.A.», `800.123.987-6`) y un CUFE
 * inexistente, con formato impecable. Copiar la proyección habría dejado dos
 * implementaciones del mismo contrato, que es exactamente el patrón que ya
 * produjo divergencias medidas en este dominio.
 */
export const FISCAL_DOCUMENT_PRINT_INCLUDE = {
  invoice_items: true,
  invoice_taxes: true,
  resolution: { select: RESOLUTION_PUBLIC_SELECT },
  organization: {
    include: {
      addresses: { take: 1 },
    },
  },
  store: {
    include: {
      addresses: { take: 1 },
    },
  },
  customer: true,
} as const;

export interface FiscalDocumentPrintOptions {
  /** PNG del QR ya generado, en base64. Se pasa hecho porque generarlo es I/O. */
  qrBase64?: string;
  /** Etiqueta de estado cuando la DIAN aceptó el documento. */
  acceptedLabel?: string;
  /** Etiqueta de estado mientras no hay aceptación. */
  pendingLabel?: string;
  /**
   * Número del documento que este documento referencia. En una nota de crédito
   * es la factura corregida, y el anexo exige que aparezca impresa: una nota sin
   * referencia no es verificable contra nada.
   */
  referenceDocumentNumber?: string;
}

const money = (n: number) => `$${n.toLocaleString('es-CO')}`;

export function mapFiscalDocumentToPrintData(
  invoice: any,
  options: FiscalDocumentPrintOptions = {},
): StandardPrintDataModel {
  const store = invoice.store || {};
  const org = invoice.organization || {};
  const cust = invoice.customer || ({} as any);
  const res = invoice.resolution || ({} as any);

  const items = (invoice.invoice_items || []).map((it: any, idx: number) => ({
    index: idx + 1,
    product_name: it.name || it.description || 'Ítem',
    variant_sku: it.sku || undefined,
    quantity: Number(it.quantity || 1),
    unit_price: Number(it.price || 0),
    unit_price_formatted: money(Number(it.price || 0)),
    discount_amount: Number(it.discount_amount || 0),
    discount_formatted: it.discount_amount
      ? `-${money(Number(it.discount_amount))}`
      : undefined,
    tax_rate: Number(it.tax_rate || 0),
    tax_amount: Number(it.tax_amount || 0),
    total_price: Number(it.total || 0),
    total_price_formatted: money(Number(it.total || 0)),
  }));

  const taxes = (invoice.invoice_taxes || []).map((t: any) => ({
    name: t.tax_name || 'IVA',
    rate: Number(t.tax_rate || 0),
    base_amount: Number(t.taxable_amount || 0),
    tax_amount: Number(t.tax_amount || 0),
    base_formatted: money(Number(t.taxable_amount || 0)),
    tax_formatted: money(Number(t.tax_amount || 0)),
  }));

  const subtotal = Number(invoice.subtotal_amount || 0);
  const discount = Number(invoice.discount_amount || 0);
  const tax = Number(invoice.tax_amount || 0);
  const total = Number(invoice.total_amount || subtotal - discount + tax);

  const accepted = invoice.dian_status === 'accepted';

  return {
    store: {
      name: store.name || org.name || 'Vendix',
      legal_name: store.legal_name || org.legal_name,
      tax_id: org.tax_id,
      phone: store.phone || org.phone,
      email: store.email || org.email,
      address:
        store.addresses?.[0]?.address_line1 ||
        org.addresses?.[0]?.address_line1,
      city: store.addresses?.[0]?.city || org.addresses?.[0]?.city,
      logo_url: store.logo_url || org.logo_url,
    },
    customer: {
      name:
        `${cust.first_name || ''} ${cust.last_name || ''}`.trim() ||
        'Consumidor Final',
      tax_id: cust.document_number || '222222222222',
      phone: cust.phone,
      email: cust.email,
    },
    document: {
      id: invoice.id,
      // `invoices` NO tiene columna `prefix`: comprobado contra el esquema vivo
      // el 2026-08-24 (`information_schema.columns` devuelve 0 filas) y
      // `schema.prisma` no la declara. Compilaba porque los getters de
      // StorePrismaService devuelven `any` (`private scoped_client: any`), o sea
      // que el acceso a campo no se typechequea: leer una columna inexistente da
      // `undefined` en silencio.
      //
      // El prefijo YA viene dentro de `invoice_number`. Por eso `prefix` se deja
      // fuera a propósito en vez de rellenarlo desde la resolución: el
      // compositor imprime `doc.prefix ? doc.prefix + '-' : ''` antes del
      // número, así que poblarlo daría `QA-#QA107` — el prefijo dos veces.
      number: invoice.invoice_number
        ? String(invoice.invoice_number)
        : String(invoice.id),
      date: invoice.issue_date
        ? new Date(invoice.issue_date).toISOString()
        : new Date().toISOString(),
      date_formatted: invoice.issue_date
        ? new Date(invoice.issue_date).toLocaleDateString('es-CO')
        : new Date().toLocaleDateString('es-CO'),
      state: invoice.dian_status || 'draft',
      state_label: accepted
        ? options.acceptedLabel || 'Aprobada por DIAN'
        : options.pendingLabel || 'Pendiente',
      notes: invoice.notes || undefined,
      reference_document_number: options.referenceDocumentNumber,
    },
    fiscal: {
      cufe: invoice.cufe || undefined,
      qr_code_content: invoice.qr_code || undefined,
      qr_code_png_base64: options.qrBase64,
      resolution_number: res.resolution_number,
      resolution_prefix: res.prefix,
      resolution_range_from: res.range_from,
      resolution_range_to: res.range_to,
      resolution_date: res.resolution_date
        ? new Date(res.resolution_date).toLocaleDateString('es-CO')
        : undefined,
      resolution_valid_from: res.valid_from
        ? new Date(res.valid_from).toLocaleDateString('es-CO')
        : undefined,
      resolution_valid_to: res.valid_to
        ? new Date(res.valid_to).toLocaleDateString('es-CO')
        : undefined,
    },
    items,
    taxes,
    totals: {
      subtotal,
      subtotal_formatted: money(subtotal),
      discount_total: discount,
      discount_total_formatted: money(discount),
      shipping_total: 0,
      shipping_total_formatted: '$0',
      tax_total: tax,
      tax_total_formatted: money(tax),
      grand_total: total,
      grand_total_formatted: money(total),
      // Mismo `total` que la fila en cifras: una segunda fuente aquí sería una
      // contradicción interna del documento legal.
      grand_total_in_words: Number.isFinite(total)
        ? amountToSpanishWords(total, { suffix: 'M/CTE' })
        : undefined,
    },
  };
}
