import { Injectable, Logger } from '@nestjs/common';
import { isEmail } from 'class-validator';
import AdmZip = require('adm-zip');
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { S3Service } from '../../../../common/services/s3.service';
import { EmailService } from '../../../../email/email.service';
import { EmailAttachment } from '../../../../email/interfaces/email.interface';
import {
  generateInvoiceEmailHtml,
  generateInvoiceEmailText,
  InvoiceEmailData,
} from '../../../../email/templates/invoice-email.template';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
// BE-E5 (E.5, casillas 3 + 5) — el constructor
// `UblAttachedDocumentBuilder.build()` (Anexo Técnico 1.9 §9.1) vivía probado
// contra el XSD en su spec desde F.12 y nunca se llamaba desde un envío de
// producción. Aquí se cablea al ZIP de reenvío.
import { UblAttachedDocumentBuilder } from '../providers/dian-direct/xml/ubl-attached-document.builder';
import { DianEventParty } from '../providers/dian-direct/xml/ubl-application-response.builder';
import { DIAN_DOCUMENT_TYPES } from '../providers/dian-direct/constants/dian-document-types';
// BE-E5 (E.5, casilla 4) — motor PDF bajo demanda del gateway, mismo servicio
// que ya usa `print-gateway.service.ts` para `engine: 'pdf'`. Slice 1
// (`d4141e00c`). Aquí se invoca para que el PDF del ZIP sea el del formato
// configurado de la tienda (`store_settings.settings.receipts.invoice_format`,
// que `resolveFiscalInvoicePaperFormat` resuelve dentro del servicio), no el
// PDF persistido en S3 al momento de emitir (que pudo haber quedado en un
// formato anterior si la tienda cambió su configuración).
import { FiscalInvoicePdfRenderService } from '../../print-formats/services/fiscal-invoice-pdf-render.service';
import { DeliverInvoiceDto } from './dto/deliver-invoice.dto';
import { writeInvoiceDeliveryEvent } from './invoice-delivery-events.writer';

/**
 * E.6 — Reenviar una factura ya emitida a otro correo (`POST /:id/deliver`).
 *
 * IDOR: la lectura de la factura pasa por `StorePrismaService.invoices`
 * (auto-alcanzada por `store_id` vía la extensión de Prisma), igual que
 * `DianEventsService.loadInvoiceOrThrow`. La escritura en
 * `invoice_delivery_events` usa `withoutScope()` a propósito — el modelo no
 * está registrado en el whitelist de alcance de `StorePrismaService` (ese
 * archivo no es territorio de este cambio) — pero los IDs que se graban
 * (`invoice_id`, `organization_id`, `store_id`) salen SIEMPRE de la fila ya
 * verificada por el read alcanzado, nunca del contexto ni de la petición: un
 * intento de otra tienda nunca encuentra la factura y nunca llega a escribir.
 *
 * NO depende de `InvoicePdfService` (que sí vive en `InvoicingModule`):
 * esa clase tiene listeners `@OnEvent('invoice.accepted'|'invoice.sent')`, y
 * una segunda instancia en un módulo aparte los duplicaría. Este servicio lee
 * `pdf_url`/`xml_document` directamente y se degrada sin adjunto si faltan.
 *
 * ⚠ DIVERGENCIA DELIBERADA vs. Anexo Técnico 1.9, §9.1 (pág. 635/753 del PDF,
 * medido con `pdftotext -layout`). La norma de ENTREGA AL ADQUIRIENTE exige:
 * (a) un único `.zip` con un `AttachedDocument` —el `ApplicationResponse` de
 * aprobación DIAN + el documento; el PDF de la representación gráfica es
 * opcional y va DENTRO del mismo zip—, (b) un asunto con 6 campos separados
 * por `;` (NIT; nombre del facturador; nº del documento electrónico `cbc:ID`;
 * código del tipo de documento según tabla 0; nombre comercial; línea de
 * negocio opcional), y (c) un tope de 2 MB por envío.
 *
 * Este endpoint NO implementa (a) ni (b): arma PDF + XML crudo en el zip (no
 * un `AttachedDocument` — el builder ya existe, probado contra el XSD, en
 * `providers/dian-direct/xml/ubl-attached-document.builder.ts`, F.12) y usa un
 * asunto libre («Reenvío de factura ...»). Es a propósito, no un olvido: §9.1
 * gobierna la entrega ORIGINAL al adquiriente registrado en la factura; este
 * endpoint reenvía a un correo ARBITRARIO que el usuario escribe en el DTO,
 * no necesariamente el del adquiriente — no es el mismo acto normativo, y
 * forzarlo a la forma de §9.1 simularía un cumplimiento que no aplica al
 * destinatario real. SÍ se aplica (c) — ver `MAX_ZIP_ATTACHMENT_BYTES` más
 * abajo—, pero como salvaguarda operativa de tamaño de correo, no como
 * cumplimiento DIAN.
 *
 * CORRECCIÓN (E.10, 2026-08-25): este docblock afirmaba que «HOY no existe
 * en el dominio un flujo de entrega automática al adquiriente». Era falso —
 * y lo comprobamos DOS veces con el mismo error de método: un `grep` de
 * `sendEmail|EmailService` acotado a este dominio (`invoicing/`) nunca iba a
 * encontrar lo que otro dominio hace con el mismo asunto. La entrega
 * primaria SÍ existe, vive en `domains/store/notifications/
 * notifications-events.listener.ts` (`@OnEvent('invoice.pdf.generated')`),
 * la dispara `invoice-pdf.service.ts` sobre facturas YA ACEPTADAS por la
 * DIAN, y lleva corriendo desde antes de este archivo: **16 de 95** facturas
 * tienen `email_sent_at`. Es ESE método, no éste, el que ejecuta el acto que
 * rige el Anexo Técnico 1.9 §9.1 — la decisión (a)/(b) de más arriba sigue
 * aplicando sólo a ESTE endpoint (reenvío a un correo arbitrario que teclea
 * el usuario), no se cae, se estrecha: el que decide si cumple §9.1 de
 * verdad es el listener, no el reenvío de conveniencia.
 *
 * Y el listener tenía, en producción, EXACTAMENTE el defecto que el párrafo
 * de abajo describía como hipotético: descargaba el PDF y, si fallaba,
 * registraba el error y seguía enviando; si además faltaba `xml_document`,
 * el correo salía sin ningún adjunto; y aun así estampaba `email_sent_at`.
 * Una factura fiscal aceptada por la DIAN podía quedar marcada como
 * enviada al cliente sin que el cliente hubiera recibido la factura, y sin
 * ninguna fila en `invoice_delivery_events` para auditarlo (las 16 tenían
 * cero). Corregido en el propio listener como parte de E.10: `email_sent_at`
 * sólo se estampa si de verdad viajó algún adjunto, y cada intento —
 * entregado o no— deja una fila aquí, con `writeInvoiceDeliveryEvent`
 * (`invoice-delivery-events.writer.ts`), el mismo escritor que usa este
 * método.
 *
 * La degradación de ESTE método (si el PDF/XML no se pueden traer, el correo
 * sale sin adjunto en vez de abortar) se mantiene: es razonable para un
 * reenvío de conveniencia donde ya existe una copia entregada por el canal
 * primario. Lo que ya no es correcto en NINGÚN camino —y quedó corregido
 * en ambos— es que esa degradación además cuente como entrega.
 *
 * ────────────────────────────────────────────────────────────────────────
 * E.5 (2026-08-26) — cierra casillas 3, 4 y 5 del audit que dejó FE-X sobre
 * `a2658ef8b`. Esta sección se concentra en el ZIP; el listener primario no
 * se toca (territorio ajeno, ver `notifications-events.listener.ts`).
 *
 *   · Casilla 3 + 5: el XML se entregaba CRUDO. Ahora se ENVUELVE en un
 *     `AttachedDocument` validable (mismo `UblAttachedDocumentBuilder` que
 *     `F.12` validó contra el XSD). El sobre lleva dentro el documento
 *     firmado en base64 (`cac:Attachment/cbc:EmbeddedDocumentBinaryObject`,
 *     `@mimeCode="text/xml"`), la representación gráfica cuando está
 *     disponible (`cbc:Note`), y el `cbc:UUID` con el CUFE/CUDE del
 *     documento envuelto y su `@schemeName` (CUFE-SHA384 para
 *     `sales_invoice`; CUDE-SHA384 para notas y documentos equivalentes).
 *     El ambiente (`cbc:ProfileExecutionID`, 1=producción / 2=habilitación)
 *     sale de `dian_configurations.environment` de la organización, con
 *     `findFirst` ordenado por `is_default` desc — el mismo selector que
 *     `InvoiceEmissionGateService.assertElectronicEmissionLive` usa para
 *     identificar la habilitación dueña del NIT, así NO se introduce un
 *     segundo criterio paralelo para la misma pregunta.
 *   · Casilla 4: el PDF adjunto era el persistido en S3 al emitir. Ahora
 *     se prefiere el render fresco de `FiscalInvoicePdfRenderService
 *     .renderBuffer(store_id, invoice_id)` — el motor pdfkit bajo demanda
 *     que `print-gateway` ya usa para `engine:'pdf'`, mismo criterio de
 *     formato (`store_settings.settings.receipts.invoice_format` vía
 *     `resolveFiscalInvoicePaperFormat`). Si el render falla (identidad
 *     fiscal incompleta, S3 sin logo, etc.) cae al PDF persistido, y si
 *     ninguno de los dos existe, sigue la degradación histórica: ZIP sin
 *     PDF. Esto resuelve el caso «la tienda cambió `invoice_format`
 *     después de emitida la factura»: el PDF que el cliente recibe ahora
 *     coincide con el formato activo, no con el formato del momento de
 *     emisión.
 *
 * El ZIP sigue siendo UN único adjunto (no se duplica con un AttachedDocument
 * suelto); los nombres de archivo son:
 *   · `Factura-{number}.xml` — el XML firmado CRUDO (igual que antes;
 *     legible y útil para auditorías).
 *   · `Factura-{number}.pdf` — el PDF en el formato actual de la tienda
 *     (re-render preferido; cae al persistido si el render falla).
 *   · `Factura-{number}-attached-document.xml` — el sobre
 *     `AttachedDocument` que exige §9.1, con el XML firmado embebido y la
 *     representación gráfica cuando hay PDF.
 */
@Injectable()
export class InvoiceDeliveryService {
  private readonly logger = new Logger(InvoiceDeliveryService.name);

  // Salvaguarda operativa de §9.1(c) — 2 MB por envío. Aplicada aquí como
  // límite práctico de correo (muchos relays/proveedores rechazan adjuntos
  // grandes), NO como cumplimiento DIAN: ver el docblock de la clase.
  private static readonly MAX_ZIP_ATTACHMENT_BYTES = 2 * 1024 * 1024;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3_service: S3Service,
    private readonly email_service: EmailService,
    // BE-E5 (E.5, casilla 4) — inyectado para re-renderizar el PDF en el
    // formato configurado de la tienda. La firma `(storeId, documentId)` no
    // se modifica (slice-1 cerrado en `d4141e00c`); el servicio resuelve
    // `invoice_format` desde `store_settings` internamente.
    private readonly fiscal_pdf_render_service: FiscalInvoicePdfRenderService,
  ) {}

  async deliver(invoice_id: number, dto: DeliverInvoiceDto) {
    // 1. Lectura alcanzada por tienda — IDOR-safe por construcción.
    //
    // DECISIÓN (E.9): los escalares de `invoices` se leen con `include`
    // (todos los ~68 que declara el modelo), NO con `select` nombrando los
    // ~18 que este método usa (`id`, `organization_id`, `store_id`, `status`,
    // `invoice_number`, `pdf_url`, `xml_document`, `cufe`, `notes`,
    // `subtotal_amount`, `discount_amount`, `tax_amount`,
    // `withholding_amount`, `total_amount`, `currency`, `issue_date`,
    // `due_date`, `invoice_type`). Se deja así A PROPÓSITO, no por simetría
    // con el resto del archivo: leer la fila para decidir su estado (`:130`,
    // 41 líneas más abajo en `fiscal-invoice.provider.ts`, la misma
    // distancia) es inevitable de cualquier forma, así que angostar aquí
    // ahorra memoria de una sola fila una vez por reenvío — no en cada
    // render fiscal, que es donde `FISCAL_DOCUMENT_PRINT_INCLUDE` sí se
    // angostó (ver `fiscal-document-print.mapper.ts`) porque ahí sí abría
    // relaciones completas (`customer: true` = `users` con `password` y
    // `two_factor_secret`). El defecto de impresión era la RELACIÓN abierta,
    // no el nivel de `invoices`; aquí ambas relaciones (`customer`,
    // `organization`) YA están angostas — el problema que E.9 corrige en el
    // mapeador nunca existió en este archivo.
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: invoice_id },
      include: {
        customer: {
          select: { id: true, first_name: true, last_name: true },
        },
        organization: {
          select: {
            id: true,
            name: true,
            legal_name: true,
            tax_id: true,
            // BE-E5 (E.5, casillas 3 + 5) — `document_type` y
            // `verification_digit` se añaden al `select` del emisor para
            // construir la `cac:SenderParty` del `AttachedDocument`
            // (`DianEventParty.document_type`/`document_dv`). Son dos
            // columnas de la fila ya cargada; no abren relación nueva. El
            // resto del include sigue idéntico — la docblock de E.9 deja
            // explícito que los escalares de `invoices` viajan con `include`,
            // no con `select`, así que no se añade ningún `select` nuevo
            // sobre la tabla raíz.
            document_type: true,
            verification_digit: true,
            phone: true,
            email: true,
            addresses: { take: 1 },
          },
        },
        invoice_items: true,
      },
    });

    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `Factura #${invoice_id} no encontrada.`,
        { invoice_id },
      );
    }

    // 2. Formato de correo — validado en el SERVICIO, no en el DTO (ver
    // docblock de `DeliverInvoiceDto`), para poder responder el 422 propio.
    const recipient = (dto.email || '').trim();
    if (!recipient || !isEmail(recipient)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DELIVERY_001,
        'El correo de destino es obligatorio y debe tener un formato válido.',
        { invoice_id, email: dto.email },
      );
    }

    // 3. Una factura en borrador todavía no es un documento emitido.
    if (invoice.status === 'draft') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DELIVERY_002,
        `La factura #${invoice.invoice_number} está en borrador; no se puede reenviar hasta que se emita.`,
        { invoice_id, status: invoice.status },
      );
    }

    // 4. Contenido del correo — mismo armado que
    // `notifications-events.listener.ts:handleInvoicePdfGenerated`, para que
    // el reenvío luzca igual que el envío original.
    const customer = invoice.customer as
      | { first_name: string | null; last_name: string | null }
      | null;
    const org = invoice.organization as
      | {
          name: string | null;
          legal_name: string | null;
          tax_id: string | null;
          phone: string | null;
          email: string | null;
          addresses?: {
            address_line1: string | null;
            city: string | null;
            state_province: string | null;
          }[];
        }
      | null;
    const address = org?.addresses?.[0];
    const store_address = address
      ? [address.address_line1, address.city, address.state_province]
          .filter(Boolean)
          .join(', ')
      : undefined;
    const customer_name =
      invoice.customer_name ||
      (customer
        ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
        : 'Consumidor Final');
    const store_name = org?.legal_name || org?.name || 'N/A';

    const email_data: InvoiceEmailData = {
      invoice_number: invoice.invoice_number,
      invoice_type: invoice.invoice_type,
      customer_name,
      issue_date: this.formatDate(invoice.issue_date),
      due_date: invoice.due_date ? this.formatDate(invoice.due_date) : undefined,
      items: (invoice.invoice_items || []).map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        tax_amount: Number(item.tax_amount),
        total_amount: Number(item.total_amount),
      })),
      subtotal: Number(invoice.subtotal_amount),
      discount: Number(invoice.discount_amount),
      tax: Number(invoice.tax_amount),
      withholding: Number(invoice.withholding_amount),
      total: Number(invoice.total_amount),
      currency: invoice.currency || 'COP',
      cufe: invoice.cufe || undefined,
      notes: invoice.notes || undefined,
      store_name,
      store_email: org?.email || undefined,
      store_phone: org?.phone || undefined,
      store_address,
      store_nit: org?.tax_id || undefined,
    };

    const html = generateInvoiceEmailHtml(email_data);
    const text = generateInvoiceEmailText(email_data);
    const subject = `Reenvío de factura ${invoice.invoice_number} - ${store_name}`;

    // 5. PDF + XML + `AttachedDocument` empaquetados en un único .zip — con
    // degradación: si algo falla al traer un adjunto, el correo sale sin esa
    // pieza en vez de abortar el reenvío completo.
    //
    // BE-E5 (E.5, casillas 3 + 4 + 5). El orden importa para el builder del
    // sobre: primero se trae el PDF (porque el `cbc:Note` de representación
    // gráfica lo lleva embebido en base64), luego el XML crudo, luego se
    // construye el `AttachedDocument` con ambos.
    const zip = new AdmZip();
    let has_zip_content = false;

    // 5.a — PDF. Preferir el render fresco de la tienda actual (casilla 4);
    // caer al PDF persistido en S3 si el render falla; caer a «sin PDF» si
    // AMBOS fallan.
    let pdf_buffer: Buffer | undefined;
    try {
      pdf_buffer = await this.fiscal_pdf_render_service.renderBuffer(
        invoice.store_id,
        invoice.id,
      );
      this.logger.log(
        `Reenvío #${invoice.invoice_number}: PDF re-renderizado en el formato actual de la tienda (${invoice.store_id}).`,
      );
    } catch (render_error) {
      this.logger.warn(
        `Reenvío #${invoice.invoice_number}: render PDF bajo demanda falló (${(render_error as Error)?.message ?? render_error}); cae al PDF persistido en S3.`,
      );
      if (invoice.pdf_url) {
        try {
          pdf_buffer = await this.s3_service.downloadFile(invoice.pdf_url);
        } catch (s3_error) {
          this.logger.error(
            `No se pudo descargar el PDF persistido de la factura #${invoice.invoice_number} para el reenvío: ${(s3_error as Error)?.message ?? s3_error}`,
          );
        }
      }
    }
    if (pdf_buffer) {
      zip.addFile(`Factura-${invoice.invoice_number}.pdf`, pdf_buffer);
      has_zip_content = true;
    }

    // 5.b — XML crudo. Se conserva el archivo original `Factura-X.xml` —
    // legible y útil para auditorías que ya esperan ese nombre —, AUNQUE
    // el sobre AttachedDocument de abajo ya lo embeba en base64. La
    // duplicación es deliberada: un cliente que abre el ZIP puede revisar
    // el XML firmado sin tener que decodificar base64, y eso no afecta el
    // cumplimiento §9.1, que pide que el sobre VAYA DENTRO del zip, no que
    // sea el único archivo.
    if (invoice.xml_document) {
      try {
        zip.addFile(
          `Factura-${invoice.invoice_number}.xml`,
          Buffer.from(invoice.xml_document, 'utf-8'),
        );
        has_zip_content = true;
      } catch (error) {
        this.logger.warn(
          `No se pudo adjuntar el XML de la factura #${invoice.invoice_number}: ${error.message}`,
        );
      }
    }

    // 5.c — `AttachedDocument` (casillas 3 + 5). El sobre exige identificar
    // al emisor y al adquiriente; los dos se construyen desde la fila ya
    // cargada — sin una segunda consulta a `users` ni a `organizations`. El
    // ambiente sale de la MISMA `dian_configurations` dueña del NIT que ya
    // usa `InvoiceEmissionGateService.assertElectronicEmissionLive` para
    // decidir si la tienda está en producción: una sola pregunta, una sola
    // fuente. Si la organización no tiene DIAN configurada (la mayoría, ver
    // la medición del 2026-08-24: 1 de 21 tiendas con fila), el reenvío
    // cae a `'test'` — el sobre sigue siendo XML UBL estructuralmente válido
    // (la spec lo cubre), sólo declara `ProfileExecutionID=2`. En ese caso
    // el sobre NO es un documento normativo (no hay DIAN que lo reciba);
    // queda como sobre de registro para el cliente.
    if (invoice.xml_document) {
      try {
        const org_record = invoice.organization as unknown as {
          tax_id: string | null;
          legal_name: string | null;
          name: string | null;
          document_type: string | null;
          verification_digit: string | null;
        } | null;
        const dian_env_config = await this.prisma.withoutScope()
          .dian_configurations.findFirst({
            where: {
              organization_id: invoice.organization_id,
              configuration_type: 'invoicing',
            },
            orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
            select: { environment: true },
          });
        const environment: 'test' | 'production' =
          dian_env_config?.environment === 'production' ? 'production' : 'test';

        const sender: DianEventParty = {
          document_type:
            org_record?.document_type ||
            (org_record?.tax_id ? '31' : '13'),
          document_number: (org_record?.tax_id || '').replace(/\D/g, ''),
          document_dv: org_record?.verification_digit || undefined,
          legal_name:
            org_record?.legal_name || org_record?.name || 'Sin razón social',
        };
        const receiver: DianEventParty = {
          document_type:
            invoice.customer_document_type ||
            (invoice.customer_tax_id ? '31' : '13'),
          document_number: (invoice.customer_tax_id || '').replace(/\D/g, ''),
          legal_name: customer_name,
        };

        // `parent_document_type_code` mapea `invoice_type_enum` al catálogo
        // `DIAN_DOCUMENT_TYPES`. Hoy solo `sales_invoice` recorre este
        // endpoint (ver `InvoiceFlowService.createFromOrder`), pero el
        // helper está escrito para tolerar los otros tipos sin inventar
        // códigos — las notas (credit_note/debit_note) son CUDE-SHA384
        // y tipo `91`/`92`; el resto cae a `INVOICE` con un warning que
        // ya existía antes de este cambio (defensa contra tipos nuevos).
        const parent_document_type_code =
          invoice.invoice_type === 'sales_invoice' ||
          invoice.invoice_type === 'invoice'
            ? DIAN_DOCUMENT_TYPES.INVOICE
            : invoice.invoice_type === 'credit_note'
              ? DIAN_DOCUMENT_TYPES.CREDIT_NOTE
              : invoice.invoice_type === 'debit_note'
                ? DIAN_DOCUMENT_TYPES.DEBIT_NOTE
                : DIAN_DOCUMENT_TYPES.INVOICE;
        const parent_document_key_scheme =
          parent_document_type_code === DIAN_DOCUMENT_TYPES.INVOICE
            ? 'CUFE-SHA384'
            : 'CUDE-SHA384';

        const issue_date_iso = new Date(invoice.issue_date)
          .toISOString()
          .slice(0, 10);

        const attached_document_xml = UblAttachedDocumentBuilder.build({
          id: invoice.invoice_number,
          issue_date: issue_date_iso,
          parent_document_key: invoice.cufe || '',
          parent_document_key_scheme,
          parent_document_id: invoice.invoice_number,
          parent_document_type_code,
          sender,
          receiver,
          attachment: {
            content_base64: Buffer.from(invoice.xml_document, 'utf-8').toString(
              'base64',
            ),
            mime_code: 'text/xml',
            filename: `Factura-${invoice.invoice_number}.xml`,
          },
          ...(pdf_buffer
            ? {
                graphic_representation_base64: pdf_buffer.toString('base64'),
              }
            : {}),
          environment,
        });

        zip.addFile(
          `Factura-${invoice.invoice_number}-attached-document.xml`,
          Buffer.from(attached_document_xml, 'utf-8'),
        );
        has_zip_content = true;
      } catch (error) {
        // Fallar al construir el sobre NO debe abortar el reenvío: el XML
        // crudo ya está dentro del ZIP (paso 5.b), y la degradación
        // histórica del servicio era «sin adjunto en vez de abortar».
        // Mismo criterio que el `catch` del PDF.
        this.logger.warn(
          `No se pudo envolver el XML de la factura #${invoice.invoice_number} en AttachedDocument: ${(error as Error)?.message ?? error}`,
        );
      }
    }

    let zip_name: string | null = null;
    const attachments: EmailAttachment[] = [];
    if (has_zip_content) {
      let zip_buffer = zip.toBuffer();

      // Tope de 2 MB (ver `MAX_ZIP_ATTACHMENT_BYTES`): si PDF+XML no caben, se
      // descarta primero el PDF —ya es el adjunto degradable en este flujo—
      // y se reintenta sólo con el XML; si ni así cabe (caso extremo), el
      // correo sale sin adjunto en vez de fallar por peso sin que nadie sepa
      // por qué.
      if (zip_buffer.length > InvoiceDeliveryService.MAX_ZIP_ATTACHMENT_BYTES) {
        this.logger.warn(
          `El zip de la factura #${invoice.invoice_number} pesa ${zip_buffer.length} bytes (> 2 MB); se descarta el PDF y se reintenta sólo con el XML.`,
        );
        const pdf_entry_name = `Factura-${invoice.invoice_number}.pdf`;
        if (zip.getEntry(pdf_entry_name)) {
          zip.deleteFile(pdf_entry_name);
          zip_buffer = zip.toBuffer();
        }
        if (
          zip.getEntryCount() === 0 ||
          zip_buffer.length > InvoiceDeliveryService.MAX_ZIP_ATTACHMENT_BYTES
        ) {
          this.logger.error(
            `La factura #${invoice.invoice_number} no cabe en 2 MB ni sin el PDF; el reenvío sale sin adjunto.`,
          );
          has_zip_content = false;
        }
      }

      if (has_zip_content) {
        zip_name = `Factura-${invoice.invoice_number}.zip`;
        attachments.push({
          filename: zip_name,
          content: zip_buffer,
          contentType: 'application/zip',
        });
      }
    }

    // 6. Envío.
    const result =
      attachments.length > 0
        ? await this.email_service.sendEmailWithAttachments(
            recipient,
            subject,
            html,
            attachments,
            text,
          )
        : await this.email_service.sendEmail(recipient, subject, html, text);

    // 7. Traza — EXACTAMENTE una fila por intento, éxito o error, ANTES de
    // decidir si esto lanza. `withoutScope()` porque `invoice_delivery_events`
    // no está en el whitelist de alcance de `StorePrismaService` (fuera de mi
    // territorio); los IDs vienen de la fila ya verificada arriba. Escritor
    // compartido con la entrega primaria (E.10) — ver
    // `invoice-delivery-events.writer.ts`.
    const created_by = RequestContextService.getUserId() ?? null;
    await writeInvoiceDeliveryEvent(
      this.prisma.withoutScope().invoice_delivery_events,
      {
        invoice_id: invoice.id,
        organization_id: invoice.organization_id,
        store_id: invoice.store_id,
        channel: 'email',
        recipient,
        zip_name,
        status: result.success ? 'sent' : 'error',
        provider_error: result.success ? null : result.error || 'unknown error',
        created_by,
      },
    );

    // 8. El fallo del proveedor se lanza DESPUÉS de persistir la traza, para
    // que el 502 nunca borre la evidencia de que el reenvío se intentó.
    if (!result.success) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DELIVERY_003,
        `El proveedor de correo no pudo reenviar la factura #${invoice.invoice_number}: ${result.error || 'error desconocido'}.`,
        { invoice_id: invoice.id, email: recipient, provider_error: result.error },
      );
    }

    return {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      recipient,
      zip_name,
      message_id: result.messageId,
    };
  }

  private formatDate(date: Date): string {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
