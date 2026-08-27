import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import { QrService } from '../../../../common/services/qr.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  InvoicePdfBuilder,
  InvoicePdfData,
} from '../../invoicing/services/invoice-pdf.builder';
import {
  PRINT_FORMATS,
  PrintFormat,
} from '../../settings/interfaces/store-settings.interface';
import { RESOLUTION_PUBLIC_SELECT } from '../../invoicing/utils/technical-key.util';
import {
  resolveFiscalIssuerForPrint,
  FiscalIssuerPrintIdentity,
} from './fiscal-issuer-identity';
import { PaperDefinition } from '../print-templates/paper-definitions';
import { resolvePaperDefinition } from '../print-templates/paper-defaults';

/**
 * Ensamblador del PDF fiscal — ESPEJO DEL CONTRATO `INVOICE_PDF_INCLUDE`
 * (`invoicing/services/invoice-pdf.service.ts:29-69`).
 *
 * E.11 casilla 4 (slice 1): el gateway necesita el Buffer del PDF sin tocar S3,
 * y la medición (`docs/plans/CP-INVOICE-MIRROR-E1-medicion-builder.md`) es
 * tajante: los datos deben salir del ensamblador del builder, NUNCA del
 * `StandardPrintDataModel` — por ese modelo se pierde la retención y el NIT
 * puede discrepar del XML.
 *
 * El include original NO está exportado y este slice no toca archivos de
 * invoicing, así que se replica aquí campo a campo. La spec de paridad
 * numérica (`print-gateway.engine-pdf.spec.ts`) alimenta la MISMA fila por los
 * DOS ensambladores y falla si divergen: esa compuerta es lo que hace seguro
 * el espejo. Si añades un campo al include original, añádelo aquí y pásala.
 */
const FISCAL_INVOICE_PDF_RENDER_INCLUDE = {
  invoice_items: true,
  invoice_taxes: true,
  resolution: { select: RESOLUTION_PUBLIC_SELECT },
  organization: {
    select: {
      id: true,
      name: true,
      legal_name: true,
      tax_id: true,
      phone: true,
      email: true,
      logo_url: true,
      fiscal_scope: true,
      addresses: { take: 1 },
      organization_settings: { select: { settings: true } },
    },
  },
  store: {
    select: {
      id: true,
      name: true,
      legal_name: true,
      tax_id: true,
      logo_url: true,
      addresses: { orderBy: [{ is_primary: 'desc' }, { id: 'asc' }], take: 1 },
      store_settings: { select: { settings: true } },
    },
  },
  customer: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
    },
  },
};

/** Formats a Date as DD/MM/YYYY — mismo formato que `InvoicePdfService`. */
function formatDate(date: Date): string {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Extrae una dirección mostrable del JSON `customer_address`. */
function formatCustomerAddress(address: any): string | undefined {
  if (!address) return undefined;

  if (typeof address === 'string') return address;

  if (typeof address === 'object') {
    const parts: string[] = [];
    if (address.address_line1) parts.push(address.address_line1);
    if (address.address_line2) parts.push(address.address_line2);
    if (address.city) parts.push(address.city);
    if (address.state) parts.push(address.state);
    if (address.state_province) parts.push(address.state_province);
    if (address.country) parts.push(address.country);
    return parts.length > 0 ? parts.join(', ') : undefined;
  }

  return undefined;
}

/**
 * Papel para la representación gráfica — siempre el setting de la TIENDA
 * (`store_settings.settings.receipts.invoice_format`), cae a `letter`.
 * Espejo de `InvoicePdfService.resolveInvoiceFormat`.
 */
export function resolveFiscalInvoicePaperFormat(store: any): PrintFormat {
  const receipts = (store?.store_settings?.settings as any)?.receipts;
  const format = receipts?.invoice_format;
  return PRINT_FORMATS.includes(format) ? format : 'letter';
}

/**
 * Fila de `invoices` (con `FISCAL_INVOICE_PDF_RENDER_INCLUDE`) →
 * `InvoicePdfData`, el contrato de entrada del builder pdfkit.
 *
 * Espejo fiel del armado de `InvoicePdfService.generatePdf` MENOS la I/O
 * (logo y QR llegan hechos, igual que en el builder) y MENOS la persistencia:
 * esto es RENDER bajo demanda, el carril de S3 sigue siendo `generatePdf`.
 *
 * Exportada PURA a propósito: la spec de paridad la ejecuta contra el mapeador
 * HTML con el mismo fixture, sin levantar Nest ni tocar Prisma.
 */
export function buildFiscalInvoicePdfData(
  invoice: any,
  issuer: FiscalIssuerPrintIdentity,
  io: { logo_buffer?: Buffer; qr_buffer?: Buffer },
): InvoicePdfData {
  const store = invoice.store || {};
  const org = invoice.organization || {};
  const customer = invoice.customer;
  const resolution = invoice.resolution;

  const customer_name =
    invoice.customer_name ||
    (customer
      ? `${customer.first_name} ${customer.last_name}`
      : 'Consumidor Final');

  return {
    // Emisor
    company_name: issuer.legal_name,
    company_nit: issuer.nit_display,
    company_address: issuer.address_line,
    company_phone: issuer.phone,
    company_email: issuer.email,
    company_logo_buffer: io.logo_buffer,
    company_trade_name: issuer.trade_name,
    company_tax_regime: issuer.tax_regime,
    company_tax_responsibilities: issuer.tax_responsibilities,

    // Paper format configured for this store.
    format: resolveFiscalInvoicePaperFormat(store),

    // Resolucion
    resolution_number: resolution?.resolution_number,
    resolution_date: resolution?.resolution_date
      ? formatDate(resolution.resolution_date)
      : undefined,
    resolution_range_from: resolution?.range_from,
    resolution_range_to: resolution?.range_to,
    resolution_prefix: resolution?.prefix,
    resolution_valid_from: resolution?.valid_from
      ? formatDate(resolution.valid_from)
      : undefined,
    resolution_valid_to: resolution?.valid_to
      ? formatDate(resolution.valid_to)
      : undefined,

    // Cliente
    customer_name,
    customer_tax_id: invoice.customer_tax_id || undefined,
    customer_address: formatCustomerAddress(invoice.customer_address),
    customer_email: customer?.email || undefined,

    // Factura
    invoice_number: invoice.invoice_number,
    invoice_type: invoice.invoice_type,
    issue_date: formatDate(invoice.issue_date),
    due_date: invoice.due_date ? formatDate(invoice.due_date) : undefined,
    payment_date: invoice.payment_date
      ? formatDate(invoice.payment_date)
      : undefined,
    currency: invoice.currency || 'COP',
    notes: invoice.notes || undefined,

    // Items
    items: (invoice.invoice_items || []).map((item: any) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      discount_amount: Number(item.discount_amount),
      tax_amount: Number(item.tax_amount),
      total_amount: Number(item.total_amount),
      applied_price_tier_name: item.applied_price_tier_name ?? null,
      stock_units_consumed:
        typeof item.stock_units_consumed === 'number'
          ? item.stock_units_consumed
          : null,
      serial_numbers_snapshot: item.serial_numbers_snapshot ?? null,
    })),

    // Taxes
    taxes: (invoice.invoice_taxes || []).map((tax: any) => ({
      tax_name: tax.tax_name,
      tax_rate: Number(tax.tax_rate),
      taxable_amount: Number(tax.taxable_amount),
      tax_amount: Number(tax.tax_amount),
    })),

    // Totals — la retención incluida; el builder la imprime cuando > 0.
    subtotal_amount: Number(invoice.subtotal_amount),
    discount_amount: Number(invoice.discount_amount),
    tax_amount: Number(invoice.tax_amount),
    withholding_amount: Number(invoice.withholding_amount),
    total_amount: Number(invoice.total_amount),

    // DIAN
    cufe: invoice.cufe || undefined,
    qr_code: invoice.qr_code || undefined,
    qr_code_buffer: io.qr_buffer,
  };
}

/**
 * Render bajo demanda del PDF de la factura electrónica DENTRO del gateway de
 * impresión — E.11 casilla 4, slice 1.
 *
 * Qué es: `engine:'pdf'` deja de mentir. El builder pdfkit existente
 * (`InvoicePdfBuilder`, las mismas primitivas del artefacto legal: GEOMETRY de
 * 5 papeles, doble pasada de rollo, sello QR §11.7 en cada página) actúa como
 * MOTOR del gateway y el Buffer viaja en `RenderResult.pdf_buffer`.
 *
 * Qué NO es: no persiste nada. Sin S3, sin `invoices.pdf_url`, sin eventos —
 * eso sigue siendo exclusividad de `generatePdf`. Dos renders consecutivos del
 * mismo documento producen bytes distintos (el builder estampa fecha/hora) y
 * la garantía exigible es SEMÁNTICA, no byte-a-byte — paridad numérica, CUFE,
 * letras (spec adjunta).
 *
 * Plantilla vs motor (decisión E.11): en HTML la plantilla congelada del perfil
 * manda sobre el contenido; en PDF el builder manda POR FIDELIDAD — el acople
 * fino template→pdfkit es el slice 2 de este paso, no este.
 *
 * Identidad del emisor: el resolvedor único con la misma asimetría estricta
 * que `generatePdf` (`dian_status !== 'not_applicable'` → estricto), así un
 * fallo de identidad corta AMBAS representaciones por igual.
 */
@Injectable()
export class FiscalInvoicePdfRenderService {
  private readonly logger = new Logger(FiscalInvoicePdfRenderService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3Service: S3Service,
    private readonly qrService: QrService,
  ) {}

  /**
   * Devuelve el Buffer del PDF fiscal para este documento, sin persistir.
   *
   * @throws VendixHttpException `PRINT_DOCUMENT_NOT_FOUND_001` si el documento
   *   no existe EN ESTA tienda, o `FISCAL_IDENTITY_INCOMPLETE` si es documento
   *   electrónico y la identidad fiscal del emisor quedó incompleta — el mismo
   *   contrato que `GET /store/invoicing/:id/pdf`.
   */
  async renderBuffer(
    storeId: number,
    documentId: number | string,
  ): Promise<Buffer> {
    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const invoice = await this.prisma.invoices.findFirst({
      where: { id, store_id: storeId },
      include: FISCAL_INVOICE_PDF_RENDER_INCLUDE,
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const strict = invoice.dian_status !== 'not_applicable';
    const issuer = resolveFiscalIssuerForPrint(
      invoice.organization,
      invoice.store,
      strict,
    );

    // Logo best-effort — igual que generatePdf: un logo ausente no invalida
    // el documento legal.
    let logo_buffer: Buffer | undefined;
    if (issuer.logo_url) {
      try {
        logo_buffer = await this.s3Service.downloadImage(issuer.logo_url);
      } catch {
        this.logger.warn('Could not download issuer logo for on-demand PDF');
      }
    }

    // QR tal cual se transmitió, renderizado a PNG — mismo criterio y tamaño
    // (320px) que `renderVerificationQr`; su ausencia degrada a URL en texto.
    let qr_buffer: Buffer | undefined;
    if (invoice.qr_code) {
      try {
        qr_buffer = await this.qrService.generateBuffer(invoice.qr_code, 320);
      } catch (error) {
        this.logger.warn(
          `No se pudo generar el QR de verificacion: ${(error as Error)?.message}`,
        );
      }
    }

    const data = buildFiscalInvoicePdfData(invoice, issuer, {
      logo_buffer,
      qr_buffer,
    });

    // E.11 slice 3 — el consumer del render consulta `paper-defaults` para
    // resolver la `PaperDefinition` del papel configurado por la tienda, ANTES
    // de invocar al builder pdfkit. La función (`InvoicePdfBuilder.generate`)
    // sigue leyendo su `GEOMETRY` interno desde `data.format`, así que el
    // Buffer que producimos es BIT-A-BIT el mismo que producía antes — esta
    // resolución es, en este slice, OBSERVABILIDAD + INTEGRACIÓN CON LA TABLA
    // SEMILLA (`print-templates/paper-definitions.ts`). El cableado fino de
    // la `PaperDefinition` hacia dentro del builder (para que `bottom_reserve`
    // y `double_pass` salgan del registry en vez del `QR_STAMP_BAND` interno)
    // es slice 4 — está marcado con TODO en este mismo método.
    const paper: PaperDefinition = resolvePaperDefinition(data.format);
    this.logger.debug(
      `[E.11 slice 3] paper_definition_resolved code=${paper.code} ` +
        `is_roll=${paper.is_roll} ` +
        `double_pass_required=${paper.double_pass_required} ` +
        `requires_multipage_qr_band=${paper.requires_multipage_qr_band} ` +
        `width_mm=${paper.width_mm} ` +
        `height_mm=${paper.height_mm ?? 'measured'}`,
    );

    // TODO(integration-slice-4): thread `paper` into `InvoicePdfBuilder.generate`.
    //   - Hoy el builder pdfkit compila su `GEOMETRY` (invoice-pdf.builder.ts:178)
    //     desde `data.format`, lectura interna, idéntica a `PAPER_DEFINITIONS`
    //     por construcción (ver `paper-defaults.spec.ts`). Pasarle la
    //     `PaperDefinition` completa permite que decisiones que ahora viven en
    //     constantes del builder (`QR_STAMP_BAND`, `QR_MIN_SIDE`,
    //     `ROLL_PROBE_HEIGHT`) salgan del registry de `paper-definitions.ts`,
    //     y deja el slice 4 con una sola fuente de verdad para los 5 papeles.
    //   - Acción concreta en slice 4:
    //       1. Extender `InvoicePdfData` con `paper?: PaperDefinition` (opt-in,
    //          no rompe consumidores actuales — `generatePdf` lo sigue armando).
    //       2. En `InvoicePdfBuilder.generate`, si llega `paper`, derivar
    //          `bottom_reserve = paper.requires_multipage_qr_band
    //            ? paper.qr_stamp_band_mm * PT_PER_MM
    //            : 0` y el flag de doble pasada de
    //          `paper.double_pass_required` en vez de `layout.roll`.
    //       3. Pasar `paper` desde aquí: `data.paper = paper;` antes del
    //          `InvoicePdfBuilder.generate(...)`. El servicio seguirá
    //          resolviendo desde `data.format` como fallback para los
    //          consumidores que ya arman `data` sin pasar por este service.
    //   - Por qué no se hace en slice 3: tocar el builder pdfkit invierte la
    //     dependencia builder→plantillas (decisión E.11: «builder pdfkit como
    //     motor, no como esclavo»), y el territorio del builder pertenece a
    //     otro agente — slice 3 sólo cierra el cableado del consumer.

    return InvoicePdfBuilder.generate(data);
  }
}
