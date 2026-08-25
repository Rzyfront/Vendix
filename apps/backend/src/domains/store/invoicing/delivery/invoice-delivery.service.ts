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
import { DeliverInvoiceDto } from './dto/deliver-invoice.dto';

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
 * Hallazgo para quien lea esto: HOY no existe en el dominio un flujo de
 * entrega automática al adquiriente en el momento de la emisión — este
 * método es el único camino de correo con zip que existe en todo el dominio
 * de facturación—. Si el negocio necesita la entrega §9.1 real, no vive
 * aquí; hay que construirla aparte reusando `ubl-attached-document.builder.ts`
 * y NO la nomenclatura `znnnnnnnnnnpppaadddddddd.zip` de
 * `utils/dian-file-naming.util.ts` (esa es §6.5.8, del zip HACIA la DIAN, un
 * flujo distinto).
 *
 * La degradación de este método (si el PDF/XML no se pueden traer, el correo
 * sale sin adjunto en vez de abortar) es razonable para un reenvío de
 * conveniencia. Sería un defecto grave si este método se reutilizara alguna
 * vez como la entrega normativa §9.1: un correo de "entrega" vacío no debe
 * contar como entregado. Si este método pasa a implementar (a)/(b), esa
 * degradación tiene que cambiar de forma primero.
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
  ) {}

  async deliver(invoice_id: number, dto: DeliverInvoiceDto) {
    // 1. Lectura alcanzada por tienda — IDOR-safe por construcción.
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

    // 5. PDF (S3) + XML (columna inline) empaquetados en un único .zip — con
    // degradación: si algo falla al traer el adjunto, el correo sale sin él en
    // vez de abortar el reenvío completo.
    const zip = new AdmZip();
    let has_zip_content = false;

    if (invoice.pdf_url) {
      try {
        const pdf_buffer = await this.s3_service.downloadFile(invoice.pdf_url);
        zip.addFile(`Factura-${invoice.invoice_number}.pdf`, pdf_buffer);
        has_zip_content = true;
      } catch (error) {
        this.logger.error(
          `No se pudo descargar el PDF de la factura #${invoice.invoice_number} para el reenvío: ${error.message}`,
        );
      }
    }

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
    // territorio); los IDs vienen de la fila ya verificada arriba.
    const created_by = RequestContextService.getUserId() ?? null;
    await this.prisma.withoutScope().invoice_delivery_events.create({
      data: {
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
    });

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
