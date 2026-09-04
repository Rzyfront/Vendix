import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { mapUserAddress } from '../lib/customer-address';
import { RESOLUTION_PUBLIC_SELECT } from '../../invoicing/utils/technical-key.util';
import { amountToSpanishWords } from '@common/utils/amount-in-words.util';
import { resolveFiscalIssuerForPrint } from '../services/fiscal-issuer-identity';

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
/**
 * Los campos de cada relación abajo son EXACTAMENTE los que el mapeador lee
 * más abajo — no una lista adivinada. Medido leyendo el `return` completo de
 * `mapFiscalDocumentToPrintData` (E.9, 2026-08-25): antes, `organization` y
 * `store` entraban con `include` completo (36 y 23 columnas para leer 7 y 6)
 * y `customer` era `true` — la relación es `customer users?` (comprobado en
 * `schema.prisma`), o sea las **31 columnas de `users`, incluidas `password`
 * y `two_factor_secret`**, en cada render fiscal, para leer 4. Hoy no era una
 * fuga (`StandardPrintDataModel` es una proyección explícita de 4 campos y no
 * hay `console.`/`logger.`/`JSON.stringify` del objeto crudo en estos
 * proveedores — comprobado con `grep`), pero el hash quedaba en el montón de
 * un proceso que compone HTML, a un `logger.debug(invoice)` futuro de
 * convertirse en fuga real. `resolution` ya usaba `select` con
 * `RESOLUTION_PUBLIC_SELECT` — el idioma correcto ya vivía en este mismo
 * archivo, sólo en dos de las cuatro relaciones.
 *
 * Verificado contra los TRES consumidores de este `include`
 * (`fiscal-invoice.provider.ts`, `credit-note.provider.ts`,
 * `fiscal-credit-note.provider.ts`): ninguno toca `organization`/`store`/
 * `customer` por su cuenta, todos pasan el `invoice`/`note` completo a este
 * mapeador. Angostar aquí no les rompe nada; si alguno empieza a leer un
 * campo nuevo de estas relaciones, el `select` de abajo es lo primero que hay
 * que tocar, no lo último.
 */
export const FISCAL_DOCUMENT_PRINT_INCLUDE = {
  invoice_items: {
    include: {
      product: {
        select: {
          sku: true,
          barcode: true,
        },
      },
      product_variant: {
        select: {
          sku: true,
          barcode: true,
        },
      },
      invoice_taxes: {
        select: {
          tax_name: true,
          tax_rate: true,
          tax_amount: true,
        },
      },
    },
  },
  invoice_taxes: true,
  resolution: { select: RESOLUTION_PUBLIC_SELECT },
  organization: {
    select: {
      name: true,
      legal_name: true,
      tax_id: true,
      phone: true,
      email: true,
      logo_url: true,
      // E.11 casilla 1 — campos que `resolveFiscalIssuerForPrint` necesita para
      // alimentar el resolvedor único de identidad fiscal: el alcance decide
      // de qué settings sale `fiscal_data`, y las columnas son el respaldo.
      fiscal_scope: true,
      document_type: true,
      person_type: true,
      organization_settings: { select: { settings: true } },
      addresses: {
        take: 1,
        select: {
          address_line1: true,
          city: true,
          state_province: true,
          municipality_code: true,
          postal_code: true,
          phone_number: true,
        },
      },
    },
  },
  // `stores` NO tiene columnas `phone` ni `email` — comprobado contra
  // `schema.prisma` (el modelo no las declara) tras un 500
  // (`PrismaClientValidationError`) al pedirlas en `select`. Con el `include`
  // completo anterior ya salían `undefined` en silencio por la misma razón
  // (Prisma sólo devuelve columnas que existen); el mapeador ya asume esa
  // ausencia con `store.phone || org.phone` y `store.email || org.email`, así
  // que el `select` no cambia ningún dato mostrado — sólo hace explícito lo
  // que ya era cierto.
  store: {
    select: {
      name: true,
      legal_name: true,
      tax_id: true,
      logo_url: true,
      // E.11 casilla 1 — bajo `fiscal_scope = 'STORE'` la identidad que firmó
      // el XML vive aquí (`settings.fiscal_data`).
      store_settings: { select: { settings: true } },
      addresses: {
        orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
        take: 1,
        select: {
          address_line1: true,
          city: true,
          state_province: true,
          municipality_code: true,
          postal_code: true,
          phone_number: true,
        },
      },
    },
  },
  customer: {
    select: {
      first_name: true,
      last_name: true,
      document_number: true,
      phone: true,
      email: true,
      // CP-print-token-flow A.2 — dirección del adquirente. Solo las
      // columnas que `mapUserAddress` lee (patrón del comentario de arriba).
      addresses: {
        take: 1,
        select: {
          address_line1: true,
          address_line2: true,
          city: true,
          state_province: true,
          country: true,
        },
      },
    },
  },
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
  /**
   * URL YA FIRMADA del logo (o `undefined` si no hay logo / la firma falló).
   * Este mapeador es una función pura sin DI, así que no puede llamar a
   * `S3Service` por su cuenta — cada provider llamante resuelve la key cruda
   * con `resolveRawLogoKey()` (abajo) y la firma antes de invocar
   * `mapFiscalDocumentToPrintData`, igual que ya hacía con `qrBase64`. Sin
   * este campo, el `logo_url` que llega al compositor sería la KEY desnuda
   * de S3, el `<img>` daría 404 y el papel mostraría `alt="Logo"` literal.
   */
  signedLogoUrl?: string;
}

/**
 * Key cruda de S3 del logo del emisor: tienda primero, organización como
 * fallback — misma prioridad que usaba el `logo_url` de abajo antes de que
 * la firma se moviera al provider. Exportada para que cada provider pueda
 * resolverla, firmarla con `S3Service`, y pasar el resultado como
 * `signedLogoUrl`.
 */
export function resolveRawLogoKey(invoice: any): string | undefined {
  const store = invoice?.store || {};
  const org = invoice?.organization || {};
  return store.logo_url || org.logo_url || undefined;
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

  const items = (invoice.invoice_items || []).map((it: any, idx: number) => {
    const unitPrice = Number(it.unit_price ?? it.price ?? 0);
    const totalPrice = Number(
      it.total_amount ??
        it.total_price ??
        it.total ??
        unitPrice * Number(it.quantity || 1),
    );
    const variantSku =
      it.sku ||
      it.product_variant?.sku ||
      it.product?.sku ||
      it.product_variant?.barcode ||
      it.product?.barcode ||
      (it.product_id ? String(it.product_id) : String(idx + 1));

    let taxRate = Number(it.tax_rate || 0);
    if (!taxRate && it.invoice_taxes && it.invoice_taxes.length > 0) {
      taxRate = Number(it.invoice_taxes[0].tax_rate || 0);
    } else if (
      !taxRate &&
      invoice.invoice_taxes &&
      invoice.invoice_taxes.length === 1 &&
      Number(it.tax_amount) > 0
    ) {
      taxRate = Number(invoice.invoice_taxes[0].tax_rate || 0);
    }

    const discountAmt = Number(it.discount_amount || 0);

    return {
      index: idx + 1,
      product_name: it.description || it.name || 'Ítem',
      variant_sku: variantSku,
      quantity: Number(it.quantity || 1),
      unit_price: unitPrice,
      unit_price_formatted: money(unitPrice),
      discount_amount: discountAmt,
      discount_formatted:
        discountAmt > 0 ? `-${money(discountAmt)}` : undefined,
      tax_rate: taxRate,
      tax_amount: Number(it.tax_amount || 0),
      total_price: totalPrice,
      total_price_formatted: money(totalPrice),
    };
  });

  const taxesMap = new Map<string, { name: string; rate: number; base_amount: number; tax_amount: number }>();
  for (const t of invoice.invoice_taxes || []) {
    const name = t.tax_name || 'IVA';
    const rate = Number(t.tax_rate || 0);
    const key = `${name}_${rate}`;
    const base = Number(t.taxable_amount || 0);
    const amt = Number(t.tax_amount || 0);
    const existing = taxesMap.get(key);
    if (existing) {
      existing.base_amount += base;
      existing.tax_amount += amt;
    } else {
      taxesMap.set(key, { name, rate, base_amount: base, tax_amount: amt });
    }
  }
  const taxes = Array.from(taxesMap.values()).map((t) => ({
    ...t,
    base_formatted: money(t.base_amount),
    tax_formatted: money(t.tax_amount),
  }));

  const subtotal = Number(invoice.subtotal_amount || 0);
  const discount = Number(invoice.discount_amount || 0);
  const tax = Number(invoice.tax_amount || 0);
  // E.11 casilla 1 — la retención viaja al papel. INFORMATIVA: no resta del
  // total (`invoice-calculator.service.ts`: «Retenciones ... NUNCA restan del
  // total»), igual que la fila «Retencion:» del builder PDF.
  const withholding = Number(invoice.withholding_amount || 0);
  const total = Number(invoice.total_amount || subtotal - discount + tax);

  const accepted = invoice.dian_status === 'accepted';

  // E.11 casilla 1 — el emisor ya NO es `org.tax_id` crudo: pasa por el
  // resolvedor único de identidad fiscal con la MISMA asimetría estricta que
  // `generatePdf` (documento electrónico → estricto; recibo interno o borrador
  // → permisivo). Si el resolvedor falla para un documento electrónico, el
  // carril del PDF legal también falla hoy: el HTML deja de imprimir un NIT
  // divergente y falla IGUAL — paridad por construcción.
  const issuer = resolveFiscalIssuerForPrint(
    org,
    store,
    invoice.dian_status !== 'not_applicable',
  );

  const PAYMENT_MEANS_LABELS: Record<string, string> = {
    '10': 'Efectivo',
    '42': 'Consignación / Transferencia',
    '47': 'Transferencia Débito Bancaria',
    '48': 'Tarjeta de Crédito',
    '49': 'Tarjeta de Débito',
    '20': 'Cheque',
    '1': 'Instrumento no definido',
    'ZZZ': 'Acuerdo mutuo',
  };

  const formLabel =
    invoice.payment_form === '2'
      ? 'Crédito'
      : invoice.payment_form === '1'
        ? 'Contado'
        : undefined;
  const meansLabel = invoice.payment_means_code
    ? PAYMENT_MEANS_LABELS[invoice.payment_means_code] || invoice.payment_means_code
    : undefined;
  const paymentMethod =
    formLabel && meansLabel
      ? `${formLabel} (${meansLabel})`
      : formLabel || meansLabel || undefined;

  return {
    store: {
      // Nombre comercial: el del dueño del alcance, como el trade_name del PDF.
      name:
        issuer.trade_name || store.name || org.name || issuer.legal_name || 'Vendix',
      legal_name: issuer.legal_name || store.legal_name || org.legal_name,
      tax_id: issuer.nit_display !== 'N/A' ? issuer.nit_display : undefined,
      phone: issuer.phone,
      email: issuer.email,
      address: issuer.fiscal_address || undefined,
      city: issuer.city || undefined,
      logo_url: options.signedLogoUrl,
      tax_regime: issuer.tax_regime,
      fiscal_responsibilities: issuer.tax_responsibilities.length
        ? issuer.tax_responsibilities
        : undefined,
    },
    customer: {
      name:
        `${cust.first_name || ''} ${cust.last_name || ''}`.trim() ||
        'Consumidor Final',
      tax_id: cust.document_number || '222222222222',
      phone: cust.phone,
      email: cust.email,
      // CP-print-token-flow A.2 — dirección del adquirente desde
      // `users.addresses[0]` (los providers la incluyen). Sin direcciones
      // queda ausente: el compositor no emite fila (invariante 1).
      ...mapUserAddress(cust.addresses?.[0]),
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
      valid_until: invoice.due_date
        ? new Date(invoice.due_date).toISOString()
        : undefined,
      valid_until_formatted: invoice.due_date
        ? new Date(invoice.due_date).toLocaleDateString('es-CO')
        : undefined,
      payment_method: paymentMethod,
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
      withholding_total: withholding,
      withholding_total_formatted: money(withholding),
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
