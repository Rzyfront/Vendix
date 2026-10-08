/**
 * PlatformDeliveryService — envío por correo de facturas del riel plataforma.
 *
 * Las facturas de plataforma NO viven en `invoices`: viven en
 * `fiscal_transmissions` (source_type='platform_invoice') con su snapshot en
 * `fiscal_evidences`. Por eso este servicio es paralelo a `InvoiceDeliveryService`
 * de tienda (que lee `StorePrismaService.invoices`).
 *
 * - Resuelve la transmisión por id (filtrando organización plataforma).
 * - Exige `dian_status='accepted'`.
 * - Destinatario: el explícito, o el email del `platform_acquirer_snapshot`.
 * - Adjuntos: ZIP con XML firmado + PDF (PlatformInvoicePdfService).
 * - Asunto DIAN (§9.1), remitente = razón social del emisor (la identidad
 *   fiscal de la organización plataforma, Vendix) y zip con nombre DIAN; ver
 *   `store/invoicing/utils/dian-delivery-envelope.util.ts`. Si la identidad de
 *   la plataforma no se resuelve, cae al asunto/remitente/zip anteriores.
 * - NO persiste en `invoice_delivery_events` (FK a `invoices`); deja
 *   `delivered_at/delivered_to` en `fiscal_transmissions.provider_response`
 *   sin pisar el resto.
 */
import { Injectable, Logger } from '@nestjs/common';
import { isEmail } from 'class-validator';
import AdmZip = require('adm-zip');

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { EmailService } from '../../../../email/email.service';
import { EmailAttachment } from '../../../../email/interfaces/email.interface';
import {
  generateInvoiceEmailHtml,
  generateInvoiceEmailText,
  InvoiceEmailData,
} from '../../../../email/templates/invoice-email.template';
import {
  buildDeliverySender,
  buildDeliverySubject,
  buildDeliveryZipName,
  DeliveryIssuerIdentity,
  resolveDeliveryIssuerIdentity,
} from '../../../store/invoicing/utils/dian-delivery-envelope.util';
import { PlatformInvoicePdfService } from './platform-invoice-pdf.service';

export interface PlatformDeliverResult {
  invoice_id: number;
  invoice_number: string;
  recipient: string;
  zip_name: string | null;
  status: 'sent';
  message_id?: string;
}

@Injectable()
export class PlatformDeliveryService {
  private readonly logger = new Logger(PlatformDeliveryService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrg: PlatformOrgService,
    private readonly email_service: EmailService,
    private readonly pdf_service: PlatformInvoicePdfService,
  ) {}

  /**
   * @param invoice_id id de la transmisión (`fiscal_transmissions.id`) de la factura plataforma
   * @param recipient correo destino; si viene vacío se usa el del snapshot del adquiriente
   * @param actor_user_id usuario que solicita el envío (log)
   */
  async deliverInvoice(
    invoice_id: number,
    recipient: string | null | undefined,
    actor_user_id: number,
  ): Promise<PlatformDeliverResult> {
    const ctx = await this.platformOrg.requirePlatformContext();
    const platformOrgId = ctx.organization_id;

    const transmission = await this.prisma
      .withoutScope()
      .fiscal_transmissions.findFirst({
        where: {
          id: invoice_id,
          organization_id: platformOrgId,
          source_type: 'platform_invoice',
        },
      });
    if (!transmission) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_001,
        `La factura ${invoice_id} no pertenece a la organización plataforma ${platformOrgId}.`,
        { invoice_id, platform_organization_id: platformOrgId },
      );
    }

    if (transmission.dian_status !== 'accepted') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DELIVERY_002,
        `La factura ${transmission.document_number} no está aceptada por la DIAN (estado: ${transmission.dian_status}); no se puede enviar por correo.`,
        { invoice_id, dian_status: transmission.dian_status },
      );
    }

    const evidences = await this.prisma
      .withoutScope()
      .fiscal_evidences.findMany({
        where: {
          fiscal_transmission_id: transmission.id,
          evidence_type: 'manual_support',
        },
        orderBy: { created_at: 'desc' },
        select: { metadata: true },
      });
    const metas = (evidences as Array<{ metadata: unknown }>).map(
      (e) => (e.metadata ?? {}) as Record<string, any>,
    );
    const acquirer = metas.find((m) => m.kind === 'platform_acquirer_snapshot');
    const invoiceSnap = metas.find((m) => m.kind === 'platform_invoice_snapshot');

    const to = (recipient || acquirer?.email || '').trim();
    if (!to || !isEmail(to)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DELIVERY_001,
        `Correo inválido o ausente: "${to}". Indique una dirección de email válida.`,
        { recipient: to },
      );
    }

    const number = transmission.document_number;
    const { issuer, operation_mode } =
      await this.resolvePlatformIssuer(platformOrgId);
    const zip = new AdmZip();
    let has_content = false;

    let pdf_buffer: Buffer | undefined;
    try {
      pdf_buffer = await this.pdf_service.previewPdf(transmission.id);
      zip.addFile(`Factura-${number}.pdf`, pdf_buffer);
      has_content = true;
    } catch (error) {
      this.logger.warn(
        `No se pudo generar el PDF de la factura plataforma ${number}: ${(error as Error)?.message ?? error}`,
      );
    }
    if (transmission.xml_document) {
      zip.addFile(
        `Factura-${number}.xml`,
        Buffer.from(transmission.xml_document, 'utf-8'),
      );
      has_content = true;
    }

    const issue_date_raw =
      (invoiceSnap?.issue_date as string | undefined) ??
      transmission.created_at ??
      undefined;
    const zip_name = has_content
      ? buildDeliveryZipName({
          issuer,
          document_number: number,
          issue_date: issue_date_raw,
          operation_mode,
          fallback_name: `Factura-${number}.zip`,
        })
      : null;
    const attachments: EmailAttachment[] = has_content
      ? [
          {
            filename: zip_name as string,
            content: zip.toBuffer(),
            contentType: 'application/zip',
          },
        ]
      : [];

    const totals = (invoiceSnap?.totals ?? {}) as Record<string, number>;
    const email_data: InvoiceEmailData = {
      invoice_number: number,
      invoice_type: 'sales_invoice',
      customer_name: acquirer?.legal_name ?? 'Cliente',
      issuer_name: issuer?.legal_name ?? 'Vendix',
      issue_date: (invoiceSnap?.issue_date as string) ??
        (transmission.created_at
          ? transmission.created_at.toISOString().slice(0, 10)
          : ''),
      items: ((invoiceSnap?.items ?? []) as Array<Record<string, any>>).map(
        (i) => ({
          description: String(i.description ?? ''),
          quantity: Number(i.quantity ?? 0),
          unit_price: Number(i.unit_price ?? 0),
          tax_amount: Number(i.tax_amount ?? 0),
          total_amount: Number(i.total_amount ?? i.line_total ?? 0),
        }),
      ),
      subtotal: Number(totals.subtotal ?? 0),
      discount: Number(invoiceSnap?.global_discount_amount ?? 0),
      tax: Number(totals.tax_amount ?? 0),
      withholding: 0,
      total: Number(totals.total ?? 0),
      currency: (invoiceSnap?.currency as string) ?? 'COP',
      cufe: transmission.cufe ?? undefined,
      store_name: 'Vendix',
    };
    const html = generateInvoiceEmailHtml(email_data);
    const text = generateInvoiceEmailText(email_data);
    const subject = buildDeliverySubject({
      issuer,
      document_number: number,
      invoice_type: 'sales_invoice',
      fallback_subject: `Factura ${number} - Vendix`,
    });
    const sender = buildDeliverySender(issuer);

    const result = attachments.length
      ? await this.email_service.sendEmailWithAttachments(
          to,
          subject,
          html,
          attachments,
          text,
          sender,
        )
      : await this.email_service.sendEmail(to, subject, html, text, sender);

    if (!result.success) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_DELIVERY_003,
        `El proveedor de correo no pudo enviar la factura ${number}: ${result.error || 'error desconocido'}.`,
        { invoice_id, email: to, provider_error: result.error },
      );
    }

    // Trazabilidad ligera: merge en provider_response sin pisar lo existente.
    try {
      const prev =
        transmission.provider_response &&
        typeof transmission.provider_response === 'object' &&
        !Array.isArray(transmission.provider_response)
          ? (transmission.provider_response as Record<string, unknown>)
          : {};
      await this.prisma.withoutScope().fiscal_transmissions.update({
        where: { id: transmission.id },
        data: {
          provider_response: {
            ...prev,
            delivered_at: new Date().toISOString(),
            delivered_to: to,
          } as any,
        },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar delivered_at en la transmisión ${transmission.id}: ${(error as Error)?.message ?? error}`,
      );
    }

    this.logger.log(
      `Platform delivery sent: invoice=${number} → ${to} (actor=${actor_user_id})`,
    );

    return {
      invoice_id: transmission.id,
      invoice_number: number,
      recipient: to,
      zip_name,
      status: 'sent',
      message_id: result.messageId,
    };
  }

  /**
   * Identidad fiscal del emisor = la organización plataforma (Vendix), con la
   * misma fuente que el PDF (`organization_settings.fiscal_data` gana sobre las
   * columnas). Nunca lanza: sin identidad el correo sale con la forma anterior.
   */
  private async resolvePlatformIssuer(platform_org_id: number): Promise<{
    issuer: DeliveryIssuerIdentity | null;
    operation_mode: string | null;
  }> {
    try {
      const org = await this.prisma.withoutScope().organizations.findFirst({
        where: { id: platform_org_id },
        select: {
          name: true,
          legal_name: true,
          tax_id: true,
          phone: true,
          email: true,
          fiscal_scope: true,
          document_type: true,
          person_type: true,
          organization_settings: { select: { settings: true } },
        },
      });
      const config = await this.prisma
        .withoutScope()
        .dian_configurations.findFirst({
          where: {
            organization_id: platform_org_id,
            configuration_type: 'invoicing',
          },
          orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
          select: { operation_mode: true },
        });
      return {
        issuer: resolveDeliveryIssuerIdentity({ organization: org as any }),
        operation_mode: (config?.operation_mode as string | undefined) ?? null,
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo resolver la identidad fiscal de la plataforma para el correo: ${(error as Error)?.message ?? error}`,
      );
      return { issuer: null, operation_mode: null };
    }
  }
}
